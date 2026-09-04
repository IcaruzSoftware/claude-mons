package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildEnvelopeWhitelistsFields(t *testing.T) {
	raw := []byte(`{
		"session_id": "abc",
		"hook_event_name": "PostToolUse",
		"tool_name": "Edit",
		"tool_use_id": "toolu_1",
		"cwd": "C:/Users/someone/secret-project",
		"prompt": "my super secret prompt",
		"tool_input": {"file_path": "secret.txt", "content": "password"},
		"tool_response": "leaked?",
		"transcript_path": "/home/x/.claude/projects/foo.jsonl"
	}`)
	env := buildEnvelope(raw, "", time.UnixMilli(1000))
	if env.Event != "PostToolUse" || env.SessionID != "abc" || env.ToolName != "Edit" || env.ToolUseID != "toolu_1" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	if env.Project == "" || len(env.Project) != 12 || strings.Contains(env.Project, "secret") {
		t.Fatalf("project should be a 12-char hash, got %q", env.Project)
	}
	out, _ := json.Marshal(env)
	for _, forbidden := range []string{"secret", "password", "leaked", "transcript", "prompt\"", "tool_input"} {
		if strings.Contains(string(out), forbidden) {
			t.Fatalf("envelope leaks %q: %s", forbidden, out)
		}
	}
	if env.TS != 1000 || env.V != 1 || env.ID == "" {
		t.Fatalf("bad metadata: %+v", env)
	}
}

func TestBuildEnvelopeExplicitEventWinsAndMalformedInputIsFine(t *testing.T) {
	env := buildEnvelope([]byte("not json"), "Stop", time.Now())
	if env.Event != "Stop" {
		t.Fatalf("want Stop, got %q", env.Event)
	}
	env = buildEnvelope([]byte(`{"hook_event_name":"UserPromptSubmit","stop_hook_active":true}`), "UserPromptSubmit", time.Now())
	if env.StopHookActive == nil || !*env.StopHookActive {
		t.Fatalf("stop_hook_active not carried")
	}
}

func TestDeliverPostsWithToken(t *testing.T) {
	var gotAuth string
	var gotBody Envelope
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	home := t.TempDir()
	port := srv.Listener.Addr().(interface{ String() string }).String()
	port = port[strings.LastIndex(port, ":")+1:]
	epJSON := `{"port":` + port + `,"token":"tok123","pid":1}`
	if err := os.WriteFile(filepath.Join(home, endpointFile), []byte(epJSON), 0o600); err != nil {
		t.Fatal(err)
	}

	env := buildEnvelope([]byte(`{"session_id":"s1"}`), "Stop", time.Now())
	if err := deliver(home, env); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if gotAuth != "Bearer tok123" || gotBody.Event != "Stop" || gotBody.SessionID != "s1" {
		t.Fatalf("server got auth=%q body=%+v", gotAuth, gotBody)
	}
	if _, err := os.Stat(filepath.Join(home, spoolFile)); !os.IsNotExist(err) {
		t.Fatalf("spool should not exist after successful delivery")
	}
}

func TestSpoolFallbackWhenAppNotRunning(t *testing.T) {
	home := t.TempDir()
	// no endpoint file at all
	env := buildEnvelope([]byte(`{"session_id":"s1","tool_name":"Bash"}`), "PostToolUse", time.Now())
	if err := deliver(home, env); err == nil {
		t.Fatalf("deliver should fail without endpoint")
	}
	if err := spool(home, env); err != nil {
		t.Fatalf("spool: %v", err)
	}
	// stale endpoint pointing at a closed port
	if err := os.WriteFile(filepath.Join(home, endpointFile), []byte(`{"port":1,"token":"x","pid":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if err := deliver(home, env); err == nil {
		t.Fatalf("deliver should fail on closed port")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("connect failure took too long: %v", elapsed)
	}
	if err := spool(home, env); err != nil {
		t.Fatalf("spool: %v", err)
	}

	f, err := os.Open(filepath.Join(home, spoolFile))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	lines := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e Envelope
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatalf("bad spool line: %v", err)
		}
		if !e.Spooled || e.ToolName != "Bash" {
			t.Fatalf("spooled envelope wrong: %+v", e)
		}
		lines++
	}
	if lines != 2 {
		t.Fatalf("want 2 spool lines, got %d", lines)
	}
}

func TestSpoolRefusesWhenFull(t *testing.T) {
	home := t.TempDir()
	big := make([]byte, maxSpoolBytes+1)
	if err := os.WriteFile(filepath.Join(home, spoolFile), big, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := spool(home, Envelope{Event: "Stop"}); err == nil {
		t.Fatalf("spool should refuse when over the size cap")
	}
}
