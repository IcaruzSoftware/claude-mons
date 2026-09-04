# claude-mons — Design Document (v1)

## Context

claude-mons is a fun side project: an OpenPets-style desktop pet crossed with Pokémon. A small pixel-art creature lives on your screen as a transparent always-on-top overlay. It starts as an egg. While you work with Claude Code, hooks report your activity to the app; the pet reacts (thinking, working, success) and earns XP. It hatches into a random species, levels up, evolves (Egg → Baby → Teen → Adult), appears on a global leaderboard, and can fight other players' mons in async auto-battles triggered by grabbing and shaking it.

The repo (`C:\Users\Gerrit\gitfork\claude-mons`) is empty except for a README. Everything below is greenfield.

### Decisions already made with the user

| Topic | Decision |
|---|---|
| Basis | From scratch. Borrow concepts from OpenPets (MIT), not code. |
| Desktop stack | Electron + TypeScript, pnpm monorepo, English-only repo, MIT license. |
| Backend | Supabase (Postgres, anonymous auth, RLS, Edge Functions). Free tier + daily GitHub Actions keepalive ping. |
| Identity | Anonymous auth. Nickname auto-generated on first launch (e.g. `Trainer_4821`), renamable in Settings. Zero friction. |
| Nations | Four nations (Water, Fire, Earth, Air), each with a personality. The player **chooses a nation at first launch** (permanent in v1). Team feeling: nation standings on the leaderboard, colleagues can join the same nation. |
| Hatching | Random species **within the chosen nation** (2 species per nation in v1: common 75 % / rare 25 %), rolled server-side. |
| Battles | Only against mons **from other nations**. |
| Evolution | Egg → Baby → Teen → Adult, driven purely by level. |
| XP | Activity mix from hooks: prompt +5, tool call +1/+2, finished turn +10, streak bonus, server-side caps. |
| Battle mode | Async auto-battle vs an opponent snapshot, deterministic server-side simulation, replayed as animation on the client. Fallback to a "Wild Mon" bot (from another nation) if no opponent. |
| Eggs | Hidden from leaderboard and battles until hatched. |
| UI | First launch → panel shows nation selection. Hover 1 s → compact card. Left-click → main panel window (Mon / Leaderboard / Battles / Settings). Right-click and tray → context menu. Shake → battle. |
| Species in v1 | 8 (2 per nation: 1 common, 1 rare). Extendable later. |
| Art | Pixel art authored in code (string-row pixel matrices + palettes), rasterized at runtime. |
| Hook forwarder | Tiny Go static binary (2 MB, 2–5 ms startup). |
| Platforms | Windows 10/11, Linux X11 (and Wayland sessions via XWayland, Electron's default). Native Wayland is out of scope for v1 (protocol forbids app-positioned always-on-top windows). |
| Build mode | **Autonomous to v1.** Phases run back-to-back without user checkpoints. Per phase: set goals → build (Workflow with subagents and/or directly) → verify tests and acceptance criteria → `git commit` + `git push` to `origin/main` (github.com/IcaruzSoftware/claude-mons) with a descriptive message → next phase. Stop only for critical blockers (see Phase 4: Supabase credentials). User gives feedback on v1. |

---

## 1. Repository layout

```
claude-mons/
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts
├─ eslint.config.js  prettier.config.js  .gitignore  .editorconfig  .nvmrc
├─ LICENSE (MIT)  README.md  CLAUDE.md  CONTRIBUTING.md
├─ docs/DESIGN.md                      # this plan, kept in the repo as the living design doc
├─ .github/workflows/ci.yml  release.yml  supabase-deploy.yml  keepalive.yml
│
├─ apps/desktop/                       # @claude-mons/desktop (Electron, electron-vite)
│  ├─ electron.vite.config.ts  electron-builder.yml  resources/ (icons, tray)
│  └─ src/
│     ├─ main/
│     │  ├─ index.ts                   # lifecycle, single-instance lock, boot order
│     │  ├─ windows/PetWindow.ts  windows/HoverCardWindow.ts  windows/PanelWindow.ts
│     │  ├─ input/CursorTracker.ts     # cursor polling, hit-test, click-through toggle, drag, shake feed
│     │  ├─ hooks/HookServer.ts  hooks/HookInstaller.ts  hooks/SpoolDrainer.ts  hooks/ActivityTracker.ts
│     │  ├─ game/GameService.ts  game/BattleService.ts
│     │  ├─ persistence/JsonStore.ts  persistence/migrations.ts
│     │  ├─ net/SupabaseClient.ts  net/SyncQueue.ts
│     │  ├─ tray/Tray.ts  updater/Updater.ts  autostart/Autostart.ts
│     │  ├─ ipc/register.ts            # all ipcMain handlers, typed
│     │  └─ sim/ScriptRunner.ts        # `claude-mons --simulate <file>`
│     ├─ preload/pet.ts  preload/panel.ts  preload/hovercard.ts
│     ├─ renderer/
│     │  ├─ pet/        (vanilla TS + canvas: index.html, main.ts, PetRenderer.ts, SpriteCache.ts, loop.ts)
│     │  ├─ hovercard/  (Preact, tiny)
│     │  └─ panel/      (Preact + signals: App.tsx, views/{Mon,Leaderboard,Battles,Settings}.tsx)
│     └─ common/ipc.ts                 # channel names + payload types
│
├─ packages/shared/                    # @claude-mons/shared — zero deps, Deno-compatible ESM TS
│  └─ src/
│     ├─ index.ts  constants.ts  types.ts
│     ├─ behavior/{states,priorities,stimuli,reducer}.ts   # pet state machine (pure)
│     ├─ input/shake.ts                                    # shake detector (pure)
│     ├─ game/{levels,xp,species,nickname}.ts
│     ├─ battle/{rng,battle}.ts
│     └─ hooks/payload.ts                                  # HookEnvelope + validator
│
├─ packages/sprites/                   # @claude-mons/sprites — pixel matrices, palettes, rasterizer
│  ├─ src/{types,palette,raster,index}.ts  src/species/*.ts  src/fx/*.ts
│  └─ scripts/preview.ts               # renders PNG sheets for review
│
├─ packages/hook-cli/                  # claude-mons-hook (Go, stdlib only)
│  ├─ go.mod  main.go  main_test.go  package.json (build script cross-compiles to dist/<os>-<arch>/)
│
└─ supabase/
   ├─ config.toml  migrations/0001_init.sql ...
   └─ functions/{_shared/,claim-nickname,ingest-xp,battle-request,heartbeat}/index.ts
```

Tooling: `electron-vite` (renderer HMR + main auto-restart in one command), `electron-builder` (NSIS, AppImage, deb; hook binary via `extraResources`), `vitest`, `eslint` + `prettier`, GitHub Actions (windows-latest + ubuntu-latest). Node 22 LTS, pnpm 10.

### Shared package rules (Node + Deno)

- Only web-standard globals (`Math`, `TextEncoder`, `crypto.getRandomValues`). No `node:` imports, no `process`, no npm deps. Enforced by ESLint scoped to `packages/shared`.
- All relative imports carry `.ts` extensions (`allowImportingTsExtensions` + `noEmit`; consumers bundle from source).
- Battle/game code: no `Math.random`, no `Date.now`; all randomness via seeded `rng.ts`.
- Edge Functions consume it via a copy step: `pnpm sync:shared` copies `packages/shared/src` → `supabase/functions/_shared/game/` (gitignored, run in CI before deploy). CI runs `deno check supabase/functions/**/index.ts` to catch Node-isms.

---

## 2. Overlay window & input

**One small window per pet** (≈2.5× the scaled sprite), not a full-screen transparent layer. Reasons: click-through toggling works identically on Windows and Linux without Electron's Windows-only `forward: true`; negligible compositing cost; multi-monitor is just moving a window; doesn't confuse screen-share pickers.

`PetWindow.ts`: `transparent, frame: false, alwaysOnTop ('screen-saver'), skipTaskbar, focusable: false (setting; default false on Linux until tested), hasShadow: false, resizable: false, backgroundThrottling: false, sandbox + contextIsolation`. Linux: `enable-transparent-visuals`, create window ~300 ms after `ready` (known black-square race), `disableGpu` setting for VMs. Reassert `alwaysOnTop` every 5 s on Windows (topmost wars).

**Hit-testing / click-through** (`CursorTracker.ts`): renderer reports the current frame's opaque bounding box; main polls `screen.getCursorScreenPoint()` (60 Hz when near/dragging, 15 Hz otherwise) and toggles `setIgnoreMouseEvents`. Renderer forwards `pointerdown/up` (only reachable on the sprite). Hover ≥ 1 s over the sprite → `HoverCardWindow` (tiny frameless non-focusable window next to the pet, Preact). Left-click → panel. Right-click → `Menu.popup()`.

**Drag**: main moves the window with the cursor at 60 Hz, feeds `(t, x, y)` samples to the shake detector, engine enters `dragged`; release → `falling` → `idle`, re-anchor to the display under the cursor.

**Movement**: sprite moves smoothly inside the window canvas; window hops only when the sprite drifts > half a sprite from center (avoids 60 Hz `setPosition` jitter). Ground line = bottom of `workArea` (pet stands on the taskbar edge). Position persisted as `{ displayId, fractionX }`. Handle `display-added/removed/metrics-changed`. DPI: canvas at `devicePixelRatio`, nearest-neighbor, integer pixel scale (setting: 2/3/4).

**Shake detector** (`shared/input/shake.ts`, pure): 1 s sliding window, dominant axis, count velocity sign reversals where both sides exceed 900 DIP/s, require ≥ 4 reversals and ≥ 250 DIP travel, 3 s cooldown. Returns `none | shaking | shake` (`shaking` gives visual feedback at ≥ 2 reversals).

---

## 3. Behavior engine (`shared/behavior`)

Pure reducer `stepBehavior(model, stimuli, now) → { model, effects }`, hosted in the pet renderer on `requestAnimationFrame`. Main only feeds stimuli and executes window effects. Same reducer runs headlessly in `pnpm sim` and `--simulate`.

States: `egg_idle, egg_wobble, hatching, idle, walk, sit, sleep, thinking, working, success, error, celebrate, dragged, shaking, falling, battle_intro, battle_attack, battle_hit, battle_win, battle_lose, evolving`.

Priorities (higher replaces lower; expiry always lowers): evolving/hatching 100 · battle_* 90 · dragged/shaking/falling 80 · celebrate 60 (3 s) · success/error 50 (2 s) · working 40 (while tools in flight, decays → thinking after 400 ms) · thinking 35 (decays → idle 8 s after last event) · walk/sit 20 · idle/egg 10 · sleep 5 (after 10 min without events/input).

Hook mapping: `UserPromptSubmit → thinking`, `PreToolUse → working`, `PostToolUse → working|thinking`, `Stop → success → idle`, `Notification → waiting pose`, `game:levelup → celebrate`, `game:hatch → hatching`, `game:evolve → evolving`. Egg stage maps activity to `egg_wobble`.

`ActivityTracker.ts` (main) collapses multiple concurrent Claude Code sessions (`session_id`) into one activity snapshot: working if any session has a tool in flight, thinking if any is mid-turn; sessions dropped on `SessionEnd` or 30 min silence.

---

## 4. Hook ingestion

**Hook binary** (`packages/hook-cli/main.go`): `claude-mons-hook --home <userData> --event <Name>`. Reads stdin (≤ 64 KiB), keeps only whitelisted fields (`session_id, hook_event_name, tool_name, tool_use_id, notification_type, source, reason`, `cwd` as a 12-char hash), **never forwards prompt text, tool input/output or transcript paths**. Reads `<home>/hook-endpoint.json` (`{ port, token, pid }`), POSTs to `http://127.0.0.1:<port>/event` with bearer token (150 ms dial / 400 ms total timeout). On any failure appends one JSONL line to `<home>/hook-spool.jsonl` (skip if > 5 MiB). Always exits 0, never writes stdout. Built with `CGO_ENABLED=0 -ldflags="-s -w"` for windows/amd64, linux/amd64, linux/arm64. CI asserts p95 < 25 ms.

The app copies the binary from `process.resourcesPath/bin/` to `userData/bin/` on start (AppImage mount paths change; NSIS updates replace the install dir) and installs hooks pointing at the stable path.

**HookServer.ts**: `http` on `127.0.0.1:0`, random 64-hex token, port file written `0600`, `POST /event` only, 204 immediately, everything else 404. **SpoolDrainer.ts**: on start and every 30 s rename spool → `.draining`, parse, feed with `spooled: true` (XP yes, animation no), delete.

**HookInstaller.ts** ("Connect Claude Code" in tray/panel): edits `~/.claude/settings.json` (honor `CLAUDE_CONFIG_DIR`), timestamped backup (keep 5), strict parse (abort on invalid JSON), remove our own entries (command contains `claude-mons-hook`), append ours, atomic write, verify. Events: `SessionStart, UserPromptSubmit, PreToolUse (matcher *), PostToolUse (matcher *), Notification, Stop, SessionEnd`, `timeout: 5`. Uninstall = same minus append. Panel reminds the user to start a new Claude Code session.

---

## 5. Game design

### 5.1 XP economy (`shared/game/xp.ts`, single source for client and server)

| Event | XP | Caps |
|---|---|---|
| `UserPromptSubmit` | +5 | 20/h, 120/day |
| `PostToolUse` | +2 mutate (Edit/Write/MultiEdit/NotebookEdit), +1 run (Bash/Task/mcp__*), +1 read (Read/Grep/Glob/Web*/unknown), 0 meta (Todo*/AskUser/PlanMode) | 30 XP/min, 600/h, 1200/day; only credited if a prompt occurred within the last 30 min |
| `Stop` | +10 | ≤ credited prompts in the hour |
| Daily bonus | +25 when day's work XP first reaches 50 | once/day |
| Streak | +10 × min(streak, 7) with the daily bonus; day active at ≥ 50 XP; streak survives gaps ≤ 3 days | UTC days |
| **Global work cap** | | **400/h, 2000/day** |

Typical engaged day ≈ 750 work XP + ~50 bonus + ~150 battle ≈ 950 XP.

### 5.2 Levels & stages (`shared/game/levels.ts`)

`xpForLevel(n) = 50·n·(n−1)` cumulative, `xpToNext(n) = 100·n`, `levelFromXp` closed-form inverse, cap 50. Stage is a pure function of level: **Egg = L1, Baby = L2–9, Teen = L10–24, Adult = L25+**. Hatch at 100 XP (= L2), Teen at 4 500 XP, Adult at 30 000 XP, L50 at 122 500.

Projection at 750 XP/day: hatch day 1, Teen day 6, Adult day 40. Single tuning knob: the slope (100 → 120 if too fast).

Stats: `statAtLevel(base, L) = floor(base · (L + 49) / 50)` (L26 ≈ 1.5×, L50 ≈ 2×). Halved from the first draft after simulation showed +1 level winning 90 % of mirror matches.

### 5.3 Nations = types

Four nations. Nation is chosen by the player at first launch and is the mon's battle type. Four-cycle, each nation beats exactly one and resists exactly one (A → B: A deals 2× to B, B deals 0.5× to A; everything else 1×):

**Water → Fire → Air → Earth → Water** (water douses fire, fire consumes air, air erodes earth, earth dams water).

| Nation | Personality / coding flavor | Palette | Stat lean |
|---|---|---|---|
| **Water** | Calm, adaptive, flows around problems. Refactoring, streams, pipelines. "Everything is a stream." | teal / deep blue / foam white | HP + DEF |
| **Fire** | Bold, fast, ships hotfixes at 2 a.m. "Move fast, break things, fix them faster." | ember red / orange / gold | ATK + SPD |
| **Earth** | Steady, reliable, tests everything twice. Infra, databases, monoliths. "It compiles on my machine and yours." | moss green / stone gray / amber | HP + DEF (tankiest) |
| **Air** | Light, curious, full of ideas. Docs, prototypes, cloud, exploration. "Just one more idea." | sky blue / cloud white / lavender | SPD (fastest) |

Nations are permanent in v1 (changing = v1.1). Colleagues can pick the same nation to form a team.

### 5.4 Species (v1: 8, two per nation)

Stat budgets: common 210, rare 215 (simulation showed larger gaps make rarer species win too reliably). Species id = Baby name lowercased. Stats HP/ATK/DEF/SPD. Hatch odds within the nation: common 75 %, rare 25 %.

| Nation | Baby → Teen → Adult | Rarity | Stats | Concept |
|---|---|---|---|---|
| Water | Dripple → Pipefin → Torrentide | common | 85/45/50/30 | Droplet → finned pipe-fish → wave-shaped whale trailing data streams |
| Water | Bubblit → Cachecoral → Deepseaquel | rare | 80/50/55/30 | Bubble jelly → coral with cache-slot polyps → deep-sea SQL kraken |
| Fire | Sparkit → Blazebit → Infernode | common | 70/60/40/40 | Ember spark → salamander of hot-reload flames → node-graph phoenix |
| Fire | Cinderpup → Hotfixhound → Overclockwolf | rare | 75/60/40/40 | Ember puppy → hound with a `!` collar tag → wolf with a glowing clock-speed crest |
| Earth | Pebblet → Boulderbyte → Monolithor | common | 90/45/55/20 | Pebble with eyes → boulder golem with byte-carvings → towering monolith with a single green test-badge eye |
| Earth | Mossling → Rootling → Terraformer | rare | 85/50/55/25 | Moss sprout → root-network creature → tortoise with a mini server rack garden on its shell |
| Air | Puffle → Gustling → Nimbyte | common | 65/50/40/55 | Cloud puff → gusty bird → cumulonimbus with lightning-bolt bits |
| Air | Wispit → Zephyrix → Stratosphinx | rare | 70/50/40/55 | Wisp → fox-like breeze spirit → sphinx sitting on a stratosphere cloud |

Each species gets three moves (normal 45 / nation-typed 40 / special 75, named with coding puns), flavor text and a per-stage visual brief in `packages/sprites/src/species/*.ts` and `docs/DESIGN.md`. Egg sprite is shared but tinted in the nation palette; cracks at 25/50/75 % of 100 XP.

Balance harness (`shared/test/balance.test.ts`): round-robin at L10 across all 8 species (only cross-nation pairings, as in real matchmaking) asserts every species wins 35–65 %, mean turns 4–7, timeouts < 2 %.

### 5.5 Battle simulation (`shared/battle/battle.ts`)

Deterministic, seed = battle id, `sfc32` PRNG seeded via `cyrb128` (integer-only, bit-exact in V8/Deno). Turn-based, max 10 turns, faster acts first (tie → seeded coin).

- Damage = `floor(power · ATK/DEF · S(avgLevel)/4 · eff · crit · variance)`, min 1, `S(L) = (L+24)/25`, variance ∈ [0.85, 1.0), crit ×2 with chance `clamp(0.08 + (SPD_a−SPD_b)/250, 0.03, 0.30)`, dodge chance `clamp((SPD_b−SPD_a)/250, 0, 0.20)`.
- Moves: normal (45), typed (40 × eff), special (75, once per battle, auto-used at ≤ 50 % HP). Policy picks the better of normal/typed with p = 0.75.
- Timeout → higher HP % wins, tie → coin.
- Output `BattleResult { seed, winner, reason, turns: [{ turn, first, actions: [{ actor, move, kind, dodged, damage, crit, effectiveness, targetHpAfter }] }], finalHp, maxHp }` — enough for the client to animate. Golden-log tests pin several seeds; the same fixtures run under `deno test`.

Measured (10-species field, L10): mean 5.1 turns, ~0 % timeouts; a 3-level gap ≈ 75/25.

### 5.6 Rewards, cooldowns

| Situation | Challenger | Defender |
|---|---|---|
| Win vs player | `30 + 5·clamp(oppLvl − myLvl, −3, 3)` (15–45) | 3 |
| Loss vs player | 10 | 8 |
| Win / loss vs Wild Mon | 20 / 5 | – |

Cooldown 5 min, 10 challenges/day, defender XP for the first 10 defenses/day. Battle XP counts for the leaderboard (`total_xp`) but not against work caps. Eggs can't battle (shake just wobbles).

### 5.7 Matchmaking (async, no queue table)

`battle-request` resolves everything in one call: atomic slot claim (`claim_battle_slot` RPC handles cooldown, daily cap, double-shakes) → opponent query **restricted to other nations** (`m.nation <> my nation`) with widening level windows ±3 → ±6 → ±10 → any, active in last 30 days, not the last opponent, prefer not fought in 24 h, `order by random()` → fallback Wild Mon (random species from a random other nation, same level) → `simulateBattle` → `settle_battle` RPC in one transaction (insert battle with both snapshots, credit XP, update nation battle tallies, notify defender). Client shows a 1.5 s "searching…" animation meanwhile.

---

## 6. Backend (Supabase)

### 6.1 Schema (`supabase/migrations/0001_init.sql`)

Tables: `players` (id = auth uid, `nickname citext unique` `^[A-Za-z0-9_]{3,16}$`, **`nation` enum (water/fire/earth/air) not null**, last_seen_at, streak_days, last_active_day, suspicion, nickname_changed_at), `mons` (one per player: species_id nullable while egg, stage enum, level, total_xp, work_xp, battle_xp, bonus_xp, stats jsonb, hatched_at/teen_at/adult_at, last_battle_at, last_opponent_id), `xp_daily` (per player/day counters and caps), `xp_minutes` (rolling caps + dedupe, pruned after 48 h), `ingest_batches` (idempotency), `battles` (id = seed, both snapshots jsonb incl. nation, winner, reason, log jsonb, xp), `battle_notifications`. Views: `leaderboard_alltime` and `leaderboard_weekly` (individual, with nation; exclude eggs and suspicion ≥ 10) and **`leaderboard_nations`** (per nation: members, hatched members, total XP, weekly XP, average level, weekly battles won/lost and win rate; "nation power" = weekly XP so a big nation can't coast forever, plus all-time total for bragging). Indexes on `mons(level) where stage <> 'egg'`, `mons(total_xp desc)`, `players(nation)`, battles by challenger/opponent.

RLS: authenticated read on players/mons/leaderboards; own-row read on xp_daily/battles/notifications; update only `seen_at` on own notifications; **no client writes anywhere else**. All writes via Edge Functions with service role calling Postgres functions `apply_xp`, `claim_battle_slot`, `settle_battle`, `prune_ephemeral` (execute revoked from anon/authenticated).

### 6.2 Edge Functions

| Function | Request → Response | Errors |
|---|---|---|
| `create-profile` | `{ nickname, nation }` → `{ player, mon }`; creates players + egg mon on first call; later calls with only `nickname` rename | 409 TAKEN, 400 INVALID / INVALID_NATION, 429 RENAME_COOLDOWN (7 days), 409 NATION_LOCKED |
| `ingest-xp` | `{ batch_id, device_id, client_version, buckets: MinuteBucket[] }` → `{ awarded, dropped[], mon: MonState, events[] (hatched/level_up/evolved/streak), notifications[] }` | 409 NO_PROFILE, 413 |
| `battle-request` | `{}` → `{ battle: { id, result, a, b, isBot }, reward, mon, cooldownUntil }` | 400 EGG_CANNOT_BATTLE, 429 COOLDOWN / DAILY_CAP |
| `heartbeat` | GET → `{ ok, pruned }`; touches the DB and prunes ephemeral tables; called daily by `keepalive.yml` cron | |

Leaderboards, own battle history and notification acks go through PostgREST + RLS directly.

`ingest-xp` pipeline: auth → idempotency insert → drop future (> +2 min) / stale (> 24 h) buckets → per-bucket plausibility clamp (≤ 6 prompts, ≤ 6 stops, ≤ 60 tools/min; tools need a prompt in the prior 30 min) → weights → per-minute cap via `xp_minutes` upsert → hourly caps → daily caps → bonuses → `apply_xp` (rolls species **within the player's nation** with `crypto.getRandomValues` when crossing 100 XP) → suspicion += 1 if > 50 % of a batch was dropped.

Nickname: reserved list (`admin, claude, anthropic, wild, system, mod, staff`), small blocklist with leetspeak normalization, in `shared/game/nickname.ts`.

---

## 7. Client sync & persistence

`JsonStore.ts`: atomic `state.json` (`.tmp` + rename), `.bak` of last good, `schemaVersion` + ordered migrations, debounced 500 ms, flush on quit. Supabase session persisted via a custom storage adapter; refresh token additionally backed up with `safeStorage`. Losing the anonymous session loses the pet — "link an email" is v1.1.

Authority: pet nickname/position/settings local; XP/level/stage **shown locally** are optimistic (provisional XP from `shared/xp.ts` with only per-minute caps); XP/level/stage **on leaderboard and in battles** are server truth. Hatch, level-up and evolution celebrations fire only from the server's `events`, so nothing is visually rolled back; if the server credited less (caps), the bar eases down with a "daily cap reached" toast.

`SyncQueue.ts`: aggregate events into UTC minute buckets; send every 60 s if pending, 5 s after a `Stop`, on start, on reconnect; same `batch_id` on retry (idempotent), exponential backoff 5 s → 5 min.

**First launch / onboarding**: the panel opens with a nation selection screen (four cards: name, personality blurb, palette, the two possible eggs shown as silhouettes). Hook events already accrue locally meanwhile. On choice: `signInAnonymously` → `create-profile { nickname: generated, nation }` → the egg appears on screen tinted in the nation palette. Until a nation is chosen, a neutral gray egg sits on screen and clicking it opens the selection.

---

## 8. Sprites (`packages/sprites`)

```ts
interface SpriteDef { id; size: 32 | 48; palette: Record<char, hex>; anchor: {x,y};
  anims: Record<AnimName, { fps; loop; frames: string[] /* size rows of size chars */ }> }
```

Frames authored as readable string rows. Grid 32 for egg/baby/teen, 48 for adult. Animations per stage: `idle, walk, sleep, work, happy, hurt, attack` (egg: `idle, wobble, crack`). `raster.ts` → `ImageData + bbox` once; renderer caches per `(sprite, anim, frame, scale, paletteVariant)` in `OffscreenCanvas`; palette variants give hit-flash/evolution glow for free; facing via `ctx.scale(-1, 1)`. FX sprites: sparkle, zzz, sweat, hearts, `?`. Tests: frames fit grid, only palette chars, non-empty bbox; CI uploads preview PNGs for visual review.

---

## 9. Tray, updates, autostart

Tray: tooltip `"<name> · Lv <n> · <state>"`; menu: Show panel, Connect/Disconnect Claude Code (status dot), Battle now, Show/Hide pet, Sprite size, Start on login, Check for updates, Quit. Linux fallback: right-click pet menu + `Ctrl+Alt+M`. `electron-updater` with GitHub provider (NSIS + AppImage auto-update; deb shows a link). Autostart via `setLoginItemSettings` (Windows) / `~/.config/autostart/claude-mons.desktop` (Linux), default off. Single-instance lock. Unsigned Windows builds will trigger SmartScreen; document it, sign later.

---

## 10. Testing

- `shared`: reducer (priority gating, expiry, decay chains, egg mapping), shake fixtures (6 Hz sine yes; slow drag, jitter, 2 reversals no), xp (weights, caps, monotonic thresholds), levels (inverse property, table snapshot), battle golden logs + termination + balance harness. Same fixtures under `deno test`.
- `desktop`: HookInstaller with fixture settings files (empty, foreign hooks, ours present, malformed), JsonStore (atomic, corrupt recovery, migrations), CursorTracker with fakes, ActivityTracker (interleaved sessions), HookServer (token, size cap).
- `hook-cli`: Go tests (whitelisting, spool fallback) + p95 timing gate.
- `pnpm sim <script.json>`: headless engine run with scripted stimuli and `expect` assertions; the same script drives the real app via `--simulate`.
- Optional Playwright-Electron smoke on Linux CI under `xvfb-run` (`continue-on-error`).

---

## 11. Phased build (autonomous, commit + push per phase)

Per phase: (1) write the phase goals and acceptance checklist, (2) build with a Workflow of subagents and/or directly, (3) run tests and check every acceptance item, fix until green, (4) `git add` + `git commit` with a descriptive message + `git push origin main`, (5) next phase. No user checkpoints until v1 (user is asleep). Critical stops only: anything destructive or outward-facing beyond pushing to this repo and deploying to the user's own Supabase project, or a blocker I cannot resolve (e.g. missing toolchain that needs admin rights). Whatever cannot be verified on this machine (Linux behavior, packaged installers on a clean VM) is built, unit-tested, and listed explicitly in the v1 hand-off notes as "unverified on real hardware".

Machine toolchain: Node 24, npm 11, Go 1.27 (at `C:\Program Files\Go\bin\go.exe`, PATH may not be refreshed in my shell), Docker installed (daemon off), winget. I install pnpm (`npm i -g pnpm`) and Deno (`npm i -g deno`) myself; Supabase CLI via `npx supabase@latest` / repo devDependency.

Existing `.gitignore` (user-generated from GitHub templates) must be rewritten in Phase 0: it currently ignores `**/[Pp]ackages/*`, `[Bb]in/`, `*.exe`, `dist/`, `out/`, `build/Release`, which would swallow `packages/`, the hook binary and build outputs. Keep `.env`, `.env.local`, `node_modules/`, logs, OS junk; add `supabase/.temp/`, `supabase/functions/_shared/game/`, `apps/desktop/out/`, `packages/hook-cli/dist/`, `release/`.

**Phase 0 — Scaffold**: pnpm workspace, tsconfig, eslint/prettier, `.gitignore`, LICENSE, `CLAUDE.md` (repo conventions for agents), `docs/DESIGN.md`, electron-vite app opening a plain window, `packages/shared` with `levels.ts` + tests, `deno check` wired, `ci.yml` on Windows + Ubuntu.
Accept: `pnpm i && pnpm test && pnpm typecheck && pnpm dev` work on both OSes; CI green.

**Phase 1 — Overlay + sprite + movement**: PetWindow, CursorTracker (hit-test, click-through, drag, falling), sprites package with egg + Promptle Baby (idle/walk/sleep), SpriteCache/loop, reducer with idle/walk/sit/sleep/dragged/falling, window following, multi-monitor, DPI, `--simulate`.
Accept: pet walks on the taskbar edge on Windows and Linux (X11 + XWayland); clicks pass through except on the sprite; draggable across monitors; no focus stealing; idle CPU < 2 %.

**Phase 2 — Hooks + XP**: Go hook binary + cross-compile, HookServer, port file, SpoolDrainer, ActivityTracker, HookInstaller (backup/merge/uninstall), GameService + `xp.ts`, JsonStore + migrations, tray, minimal panel (XP, level, connection status), thinking/working/success/error states + FX, hover card.
Accept: Connect produces the documented hooks JSON with foreign hooks intact; pet reacts within 100 ms of a tool call; hook p95 < 25 ms; spooled XP is credited after restart; two parallel sessions don't flicker.

**Phase 3 — Nations, egg, hatching, evolution (local)**: nation selection screen in the panel, nation-tinted egg, egg/hatching/evolving/celebrate states and sprites, all 8 species × Baby/Teen/Adult sprite sets, level-up celebration, panel Mon view (nation badge, species, stats). Hatch/evolution driven locally for now behind a `LOCAL_GAME` dev flag (species rolled locally within the nation) so the phase is testable without a backend.
Accept: fresh install = nation selection → nation egg; sim script egg → adult passes; every species/stage renders all animations.

**Phase 4 — Supabase + leaderboard**: migrations (incl. nation enum and `leaderboard_nations`), RLS, RPCs, `create-profile`, `ingest-xp`, `heartbeat`, `keepalive.yml`, anonymous auth + generated nickname, SyncQueue, reconciliation, server-driven hatch/evolution (remove `LOCAL_GAME`), Leaderboard view (nation standings on top, individual all-time + weekly with nation badges, filter "my nation", "around me"), Settings (rename).
Prerequisites (done): Supabase project `dbeotjfprckdrymmpexv` exists. The user wrote `.env.local` (gitignored, verified) with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`. I source that file into the environment of CLI commands only (never print values) and run `npx supabase link/db push/functions deploy/projects api-keys` non-interactively. Anonymous sign-ins are enabled by me via `supabase config push` (`[auth] enable_anonymous_sign_ins = true`) or the Management API auth-config endpoint, since the toggle wasn't visible in the dashboard. No GitHub↔Supabase integration is needed (deploys run from this machine; `supabase-deploy.yml` stays manual-dispatch). `heartbeat` is deployed with `verify_jwt = false` so the keepalive workflow needs no secret. `supabase-deploy.yml` is manual-dispatch and documents the `SUPABASE_ACCESS_TOKEN` secret the user can add later.
Accept: XP visible on leaderboard within 60 s; nation standings update; offline day reconciles without loss; `deno check` + shared fixtures pass under Deno.

**Phase 5 — Battles**: shake detector + feedback, `battle.ts` + species data + cross-nation balance harness, `battle-request` (other nations only) + RPCs, BattleService, arena window resize, battle_* states, opponent rendering with nation colors, Battles view (history + replay), notifications for defenders, nation win/loss tallies.
Accept: shaking ≈ 1 s starts a battle against another nation; same seed replays identically client/server; cooldown/offline show error pose + toast.

**Phase 6 — Packaging + release**: electron-builder (NSIS, AppImage, deb), hook binary in resources → userData/bin, electron-updater, `release.yml` on `v*` tags, `supabase-deploy.yml`, autostart, Linux tray fallbacks, README install docs (Wayland/AppArmor notes), Playwright smoke.
Accept: tagged build yields installers for both OSes with working auto-update; clean install → egg → connect → XP on a fresh Windows 11 and Ubuntu 24.04.

---

## 12. Verification (end-to-end)

1. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `deno check` green locally and in CI on both OSes.
2. `pnpm sim scripts/day-in-the-life.json` passes (egg → hatch → working states → level-up).
3. Manual: `pnpm dev` → nation selection → nation egg appears on the taskbar edge → tray "Connect Claude Code" → open a new Claude Code session → run a prompt → egg wobbles, XP increments in hover card → after 100 XP the egg hatches into one of the nation's two species (Phase 4: server-rolled) → leaderboard shows the nickname and nation standings → drag + shake → battle against another nation plays → history shows the log.
4. Kill the app, use Claude Code, restart → spooled XP credited.
5. Packaged installers tested on a clean Windows 11 VM and Ubuntu 24.04 (GNOME/Wayland session, runs via XWayland).

## Open items for later (not v1)

Native Wayland support; email/GitHub account linking; changing nation; more species per nation; usage-profile-influenced stats ("nature"); nation-wide events/seasons; code signing; public web leaderboard page; sounds.
