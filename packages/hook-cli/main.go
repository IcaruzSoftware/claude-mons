// claude-mons-hook forwards Claude Code hook events to the running claude-mons desktop app.
//
// It is invoked by Claude Code on every hook event (including every tool call), so it must be
// tiny and fast. It reads the hook JSON from stdin, keeps only a whitelist of metadata fields
// (never prompt text, tool input/output or transcript paths), and POSTs the envelope to the
// app's localhost endpoint. If the app is not running, the envelope is appended to a spool file
// that the app drains on its next start, so no XP is lost.
//
// Usage: claude-mons-hook --home <appDataDir> --event <HookEventName>
//
// The binary never writes to stdout (Claude Code parses hook stdout) and always exits 0.
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	maxStdin      = 64 << 10 // 64 KiB
	maxSpoolBytes = 5 << 20  // 5 MiB
	dialTimeout   = 150 * time.Millisecond
	totalTimeout  = 400 * time.Millisecond
	endpointFile  = "hook-endpoint.json"
	spoolFile     = "hook-spool.jsonl"
)

// Envelope is what the desktop app receives. Keep in sync with packages/shared/src/hooks/payload.ts.
type Envelope struct {
	V                int    `json:"v"`
	ID               string `json:"id"`
	TS               int64  `json:"ts"`
	Event            string `json:"event"`
	SessionID        string `json:"session_id,omitempty"`
	Project          string `json:"project,omitempty"`
	ToolName         string `json:"tool_name,omitempty"`
	ToolUseID        string `json:"tool_use_id,omitempty"`
	NotificationType string `json:"notification_type,omitempty"`
	Source           string `json:"source,omitempty"`
	Reason           string `json:"reason,omitempty"`
	StopHookActive   *bool  `json:"stop_hook_active,omitempty"`
	Spooled          bool   `json:"spooled"`
}

type endpoint struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

var debug = os.Getenv("CLAUDE_MONS_DEBUG") == "1"

func logf(format string, args ...any) {
	if debug {
		fmt.Fprintf(os.Stderr, "claude-mons-hook: "+format+"\n", args...)
	}
}

func main() {
	home := flag.String("home", "", "claude-mons data directory (contains hook-endpoint.json)")
	event := flag.String("event", "", "Claude Code hook event name")
	flag.Parse()

	if *home == "" {
		logf("missing --home")
		return
	}

	input, _ := io.ReadAll(io.LimitReader(os.Stdin, maxStdin))
	env := buildEnvelope(input, *event, time.Now())

	if err := deliver(*home, env); err != nil {
		logf("deliver failed: %v; spooling", err)
		if err := spool(*home, env); err != nil {
			logf("spool failed: %v", err)
		}
	}
}

// buildEnvelope extracts the whitelisted fields from the raw hook JSON.
func buildEnvelope(raw []byte, event string, now time.Time) Envelope {
	var in map[string]any
	_ = json.Unmarshal(raw, &in) // malformed input is fine: we still record the event type

	str := func(k string) string {
		if v, ok := in[k].(string); ok {
			return v
		}
		return ""
	}

	env := Envelope{
		V:                1,
		ID:               randomID(),
		TS:               now.UnixMilli(),
		Event:            event,
		SessionID:        str("session_id"),
		ToolName:         str("tool_name"),
		ToolUseID:        str("tool_use_id"),
		NotificationType: str("notification_type"),
		Source:           str("source"),
		Reason:           str("reason"),
	}
	if env.Event == "" {
		env.Event = str("hook_event_name")
	}
	if cwd := str("cwd"); cwd != "" {
		sum := sha1.Sum([]byte(cwd))
		env.Project = hex.EncodeToString(sum[:])[:12]
	}
	if v, ok := in["stop_hook_active"].(bool); ok {
		env.StopHookActive = &v
	}
	return env
}

func randomID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// deliver POSTs the envelope to the local app. Any failure returns an error quickly.
func deliver(home string, env Envelope) error {
	data, err := os.ReadFile(filepath.Join(home, endpointFile))
	if err != nil {
		return err
	}
	var ep endpoint
	if err := json.Unmarshal(data, &ep); err != nil {
		return err
	}
	if ep.Port <= 0 || ep.Token == "" {
		return errors.New("invalid endpoint file")
	}
	return post(fmt.Sprintf("http://127.0.0.1:%d/event", ep.Port), ep.Token, env)
}

func post(url, token string, env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: totalTimeout,
		Transport: &http.Transport{
			DialContext:       (&net.Dialer{Timeout: dialTimeout}).DialContext,
			DisableKeepAlives: true,
		},
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// spool appends the envelope as one JSONL line so the app can credit it later.
func spool(home string, env Envelope) error {
	path := filepath.Join(home, spoolFile)
	if st, err := os.Stat(path); err == nil && st.Size() > maxSpoolBytes {
		return errors.New("spool full")
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	env.Spooled = true
	line, err := json.Marshal(env)
	if err != nil {
		return err
	}
	_, err = f.Write(append(line, '\n'))
	return err
}
