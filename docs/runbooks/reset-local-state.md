---
doc_type: runbook
purpose: "Reset or recover local game state when testing or troubleshooting the desktop app."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/src/main/persistence/state.ts
  - apps/desktop/src/main/persistence/JsonStore.ts
  - apps/desktop/README.md
  - PRIVACY.md
---

# Reset Local State

Use this runbook to reset app state, recover from corruption, or clear a specific part of the game for testing. Resetting state creates a new anonymous player on the server; the old player row becomes orphaned if it was ever synced.

## Full reset

Delete the entire state file and quit the app. The next launch will use defaults and auto-generate a new device ID.

### On Windows

**Delete** `<userData>/state.json` and any `.bak`, `.tmp`, or `.corrupt-<timestamp>.json` files in that folder. Quit and restart the app.

### On Linux

```bash
rm -f ~/.config/claude-mons/state.json*
```

Quit and restart the app.

## Partial resets

Quit the app first. Edit `<userData>/state.json` (or `.bak` if the primary is corrupt) in a JSON editor and modify only the fields you need to reset:

| Field | Purpose of reset |
|---|---|
| `profile` | Wipe nickname, nation, and userId; on next launch, onboarding shows again |
| `pet` | Set `speciesId: null` to return to egg; seed persists (fixed per install) |
| `progress` | Set `localXp: 0`, `serverXp: null`, `stage: 'egg'` to restart leveling |
| `ledger` | Set `credited: []`, `pending: []`, `lastSyncAt: null` to clear XP sync queue |
| `hooks.installedAt` | Set to `null`; hooks will be re-verified on next launch |
| `ui.panel` | Set to `null` to reset window position to default |
| `auth.session` | Set to `null` to sign out of Supabase |
| `battles` | Set `history: []`, `lastBattleAt: null`, `today: { day: '', count: 0 }` to clear battle log and daily cap |

After editing, save the file and restart the app.

## Corrupt or missing state

If `<userData>/state.json` is unreadable, `JsonStore` from `apps/desktop/src/main/persistence/JsonStore.ts` automatically falls back:

1. Load from `<userData>/state.json` if valid
2. Load from `<userData>/state.json.bak` if valid
3. Use defaults (full reset) if both are missing or corrupt

When a file cannot be parsed, a timestamped copy is saved to `<userData>/state.json.corrupt-<timestamp>.json` for manual inspection.

**To recover:** ensure the `.bak` file is valid JSON. If both are corrupt, delete both and restart (which defaults to a new game).

## Fast testing with dev flags

Restart the app with flags to skip onboarding and jump to game state. Flags are parsed in `apps/desktop/src/main/App.ts`.

```bash
# Windows: from Command Prompt
cd "C:\Users\<user>\AppData\Local\Programs\claude-mons"
claude-mons.exe --dev-nation water --dev-xp 10 --capture C:\temp\screenshot.png

# Linux
claude-mons --dev-nation water --dev-xp 10
```

| Flag | Effect |
|---|---|
| `--dev-nation <water\|fire\|earth\|air>` | Auto-choose nation after 1 s (development only) |
| `--dev-xp <n>` | Grant XP via `game.grantXp(n, 'server')` after 2 s |
| `--dev-battle` | Trigger a wild battle after 2.5 s |
| `--capture <path.png>` | Screenshot pet window 3 s after boot |

Set environment variables for offline testing:

```bash
# Windows
set CLAUDE_MONS_OFFLINE=1
set CLAUDE_MONS_DEBUG=1

# Linux
export CLAUDE_MONS_OFFLINE=1
export CLAUDE_MONS_DEBUG=1
claude-mons
```

| Variable | Effect |
|---|---|
| `CLAUDE_MONS_OFFLINE=1` | No backend; local game + wild battles only |
| `CLAUDE_MONS_DEBUG=1` | PetHost logging + renderer debug overlay |
| `CLAUDE_MONS_DISABLE_GPU=1` | Disable GPU acceleration |

## Acceptance

- Verify the correct state file was deleted or edited
- Restart the app and confirm new state is generated or old changes are applied
- For recovery: if `.bak` exists and is valid JSON, restarting loads from it
- For dev flags: check that nation is auto-chosen, XP is granted, and battle triggers as expected
