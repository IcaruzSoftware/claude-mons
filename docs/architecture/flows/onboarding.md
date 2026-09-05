---
doc_type: architecture
purpose: "Read this when tracing what happens between first launch and a hatched mon: nation choice, anonymous sign-in, create-profile, and who decides the hatch."
audience: agent
last_verified: 2026-09-05
last_verified_commit: eefd2a2
related_files:
  - apps/desktop/src/main/App.ts
  - apps/desktop/src/main/PetHost.ts
  - apps/desktop/src/main/petGate.ts
  - apps/desktop/src/main/tray/Tray.ts
  - apps/desktop/src/renderer/panel/App.tsx
  - apps/desktop/src/renderer/panel/views/Onboarding.tsx
  - apps/desktop/src/renderer/panel/onboardingSteps.ts
  - apps/desktop/src/renderer/panel/panel.css
  - apps/desktop/src/renderer/ui/hookStatus.ts
  - apps/desktop/src/main/net/SyncQueue.ts
  - apps/desktop/src/main/net/SupabaseClient.ts
  - apps/desktop/src/main/net/config.ts
  - apps/desktop/src/main/game/GameService.ts
  - supabase/functions/create-profile/index.ts
---

# Onboarding flow

First launch to a hatched mon: default local state, a permanent nation choice, anonymous
Supabase auth, profile creation on the server, and the egg-to-baby hatch — decided by the server
when a backend is configured, or locally in offline builds.

## Walk-through

`App.start` (`apps/desktop/src/main/App.ts:start`) loads `store.load()`, which returns
`defaultState()` (`apps/desktop/src/main/persistence/state.ts`) on first run: `profile.nation` is
`null`, `progress.stage` is `'egg'`. `backendConfig()` (`apps/desktop/src/main/net/config.ts`)
picks the Supabase URL/anon key unless `CLAUDE_MONS_OFFLINE=1`, in which case it returns `null` and
`App.start` never constructs a `SupabaseClient`. `GameService` is built with
`localGame: !this.api` — that one flag decides who is authoritative for hatching, below.

Because `state.profile.nation` is null, `App.start` calls `this.panel.show()`. The pet window
itself is *not* shown yet: `PetHost.start` (`apps/desktop/src/main/PetHost.ts:start`) always
constructs and loads the (hidden, `show: false`) `BrowserWindow` so it is ready the instant a
nation is picked, but only calls `window.show()` and starts the cursor tracker once
`canRevealPet` (`apps/desktop/src/main/petGate.ts`) is true — nation set, `ready-to-show` fired,
and the user hasn't hidden the pet from the tray. `PetHost.stimulate` similarly drops every
stimulus while `nation` is null (`canStimulatePet`), so a stray hook event during onboarding
cannot animate a window that shouldn't be on screen. Until a nation is chosen, the tray tooltip
reads "claude-mons — choose your nation" and its menu is reduced to a single "Finish setup" item
that reopens the panel (`apps/desktop/src/main/tray/Tray.ts`).

The panel renderer (`apps/desktop/src/renderer/panel/App.tsx`) renders `Onboarding`
(`apps/desktop/src/renderer/panel/views/Onboarding.tsx`) whenever `snapshot.value.profile.nation`
is falsy — this check runs on every snapshot, not just at boot, so it also covers the (currently
unreachable in v1) case of a nation-less profile appearing later. `apps/desktop/src/renderer/panel/App.tsx`
passes the live `UiSnapshot` in as a prop (`<Onboarding s={s} />`) so the wizard can read hook
status without its own IPC round-trip. `Onboarding` is a 5-step wizard (step index kept in local component state, not
persisted): **1. Welcome** (title, one-line pitch, an untinted egg that slowly cycles through each
nation's tint via `SpriteView`); **2. What is claude-mons** (three bullets: taskbar-edge pet, XP
from real Claude Code activity with no prompt text ever leaving the machine, egg→baby→teen→adult);
**3. Controls** (a compact hover/click/drag/shake/Settings/leaderboard reference table); **4.
Connect Claude Code** (two sentences on what connecting does, a primary "Connect Claude Code"
button and a secondary "Skip for now"); **5. Choose your nation** — the four-card picker from
`NATION_INFO`/`speciesForNation` (species detail, palette and hatch rarity are covered in
`../../design/species-and-nations.md`, not restated here), noting the choice is permanent. Copy for
all five steps lives in the `onboardingCopy` constant at the top of
`apps/desktop/src/renderer/panel/views/Onboarding.tsx`; step
transitions go through the pure helpers in
`apps/desktop/src/renderer/panel/onboardingSteps.ts`. Only step 5 calls
`window.monsUi.chooseNation(n)` on click, disabling all four buttons while the call is in flight.
The nation grid is sized (padding, font sizes, a 2-line `-webkit-line-clamp` on each card's
personality blurb, a 1-line ellipsis on its tagline) to fit the 440×660 panel with no scroll; the
onboarding content pane also hides its scrollbar (`scrollbar-width: none` /
`::-webkit-scrollbar { display: none }` in `apps/desktop/src/renderer/panel/panel.css`) while
staying scrollable if the window is resized smaller.

**Step 4, Connect Claude Code**, reuses the existing hook toggle: its primary button calls
`window.monsUi.toggleHooks()` (`IPC.uiToggleHooks`, the same IPC the Settings hook row uses) and
then renders the resulting `s.hooks.status` inline via the shared helpers in
`apps/desktop/src/renderer/ui/hookStatus.ts` — a green dot and "Connected. Start a new Claude Code
session to begin training." for `installed-binary`/`installed-script`, otherwise the label for the
status plus a hint to finish in Settings later. It never installs hooks without the click. The
secondary "Skip for now" button and the nav's own "Next" both call the same
`nextOnboardingStep` advance.

That IPC call (`IPC.uiChooseNation`) reaches `App.chooseNation`
(`apps/desktop/src/main/App.ts:chooseNation`), which is **idempotent by construction**: its first
line is `if (this.store.get().profile.nation) return;` — a second call with any nation, including
a race from a double-click, is a no-op once the field is set. The choice is permanent in v1; there
is no client or server path to change it later (`create-profile`'s own lock is described below).
On the first call it persists `profile.nation`, tells `PetHost.setNation` to retint the sprite and
reveal the (until now hidden) pet window, fires a `game:levelup` stimulus purely for the on-screen
celebration wobble (no XP or level change), and pushes a snapshot so the panel leaves `Onboarding`
immediately, landing on the Mon tab — all of this is local and does not wait on the network.

Still inside `chooseNation`, if a `SyncQueue` exists (i.e. a backend is configured) it kicks off
`this.sync.ensureProfile({ nation })` asynchronously. `SyncQueue.ensureProfile`
(`apps/desktop/src/main/net/SyncQueue.ts:ensureProfile`) first calls
`SupabaseClient.ensureSession()` (`apps/desktop/src/main/net/SupabaseClient.ts:ensureSession`),
which signs in anonymously (`client.auth.signInAnonymously()`) the first time there is no session,
and persists the resulting session through the `SessionStorage` adapter the caller supplied — in
`App.start` that adapter reads/writes `store.get().auth.session` / `s.auth.session = v`, so the
session lives in `<userData>/state.json` under the `auth` key, survives restarts, and is refreshed
by `autoRefreshToken: true`. `ensureSession` caches the resulting user id in memory for the process
lifetime.

With a session in hand, `ensureProfile` invokes the `create-profile` Edge Function
(`supabase/functions/create-profile/index.ts`) with `{ nation }`. For a brand-new player this
creates the `players` row (nation locked in from here on — a later `nation` that differs gets
`409 NATION_LOCKED`) and the `mons` row (the egg), returning a server-generated nickname
(`generateNickname`) since none was supplied. `SyncQueue.ensureProfile` stores the returned
`userId` into `profile.userId`, the returned nickname into `profile.nickname`, and — defensively —
`profile.nation` if it were somehow still unset, then emits `profile` (→ `App` re-pushes a
snapshot) and calls `flush()` to send any pending XP buckets right away.

If `create-profile` fails, `ensureProfile` catches the error: it always calls `setStatus` with
`lastError` set (surfaced in the panel as sync status), and only *rethrows* when the failure is a
4xx `ApiCallError` (`err.status < 500`); any other failure (network error, 5xx) is swallowed and
`ensureProfile` returns `null`. `App.chooseNation`'s `.catch` only logs a warning either way — the
nation choice and local egg already happened and are not rolled back. Separately,
`SyncQueue.flush` (the periodic path, not the onboarding path) treats an `ApiCallError` whose
`code === 'NO_PROFILE'` specially by clearing `profile.userId`/`profile.nickname` so the next flush
re-creates the profile; a nation that was never accepted server-side is retried by every later
`flush()`, since `flush` calls `ensureProfile` again whenever `!s.profile.userId || !s.profile.nickname`.

The egg sprite does not change until XP arrives — nothing in onboarding itself hatches it. From
there the two authority modes diverge:

- **Online** (`localGame: false`): the server decides. `SyncQueue`'s `synced` event carries
  `mon.speciesId`/`mon.stage` from the `ingest-xp` response; `GameService.applyServerState`
  (`apps/desktop/src/main/game/GameService.ts:applyServerState`) stores `speciesId` the first time
  the server sends a non-null one, stamps `hatchedAt`, and emits `hatch`. Stage only ever moves
  forward (`egg → baby → teen → adult`) and is taken from `serverStage` when present. See
  `../../design/backend-rules.md` (`## Server-side species roll`) for how the server itself decides
  when and what to roll — not restated here.
- **Offline** (`CLAUDE_MONS_OFFLINE=1`, `localGame: true`): `GameService.ingest`/`grantXp` run
  `afterXpChange` after every XP credit, which derives the target stage from `stageForLevel`
  locally; the first time that crosses from `egg` it calls `this.opts.rollSpecies(nation, seed)`
  (`rollSpeciesForNation` in `apps/desktop/src/main/game/species.ts`) to pick a species from the
  chosen nation's pool, then emits `hatch`.

Either path funnels through `App.wireGameEvents`'s `hatch` handler: it fires a `game:hatch` stimulus
(crack animation) immediately, then after 2500 ms calls `PetHost.setStage('baby', speciesId)` and
pushes a snapshot — the delay lets the crack animation finish before the sprite swaps.

## Sequence

```mermaid
sequenceDiagram
    participant Onboarding
    participant App
    participant SyncQueue
    participant SupabaseClient
    participant create_profile as create-profile
    participant GameService

    App->>App: start() loads defaultState (nation=null, stage=egg)
    Note over App: PetHost window stays hidden; tray shows "Finish setup"
    App->>Onboarding: panel.show() (5-step wizard, step 5 = nation)
    Onboarding->>App: uiChooseNation(n)
    App->>App: chooseNation(n) — no-op if nation already set
    Note over App: PetHost.setNation reveals the window + wobble
    App-->>Onboarding: pushSnapshot() (leaves Onboarding, Mon tab)
    App->>SyncQueue: ensureProfile({nation})
    SyncQueue->>SupabaseClient: ensureSession()
    SupabaseClient->>SupabaseClient: signInAnonymously() (first time only)
    SyncQueue->>create_profile: invoke create-profile {nation}
    alt success
        create_profile-->>SyncQueue: {player, mon, created}
        SyncQueue->>SyncQueue: store profile.userId/nickname
        SyncQueue->>SyncQueue: flush() pending XP
    else 4xx (e.g. NATION_LOCKED)
        create_profile-->>SyncQueue: ApiCallError
        SyncQueue-->>App: rethrown, caught and logged
    else network / 5xx
        create_profile-->>SyncQueue: ApiCallError
        SyncQueue-->>App: swallowed, returns null
    end
    Note over GameService: egg persists until XP arrives
    alt online (localGame=false)
        SyncQueue->>GameService: synced → applyServerState(mon)
        GameService->>GameService: hatch when server sends speciesId
    else offline (CLAUDE_MONS_OFFLINE=1)
        GameService->>GameService: afterXpChange → rollSpeciesForNation
    end
    GameService-->>App: emit hatch
    App->>App: setStage('baby', speciesId) after 2500 ms
```

## Where state lives

| What | Where |
|---|---|
| Nation, stage, XP, hatch timestamp | `<userData>/state.json` (`profile`, `progress`, `pet` — see `../../../apps/desktop/README.md` for the persistence model) |
| Supabase session (anonymous JWT) | `<userData>/state.json` → `auth.session`, via the `SessionStorage` adapter `App.start` passes to `SupabaseClient` |
| Server-side player/mon rows | Supabase `players`/`mons` tables, created by `create-profile`; see `../../design/backend-rules.md` |

For the Supabase Edge Function auth model (`requireUser`, service-role RPCs) see
`../../design/backend-rules.md`. For XP thresholds and stage levels
(`HATCH_XP`/`stageForLevel`), see `../../design/species-and-nations.md` and
`../../design/economy.md` — not restated here.
