---
doc_type: design
purpose: "Read this when redesigning a specific panel tab (Mon, Leaderboard, Battles, Settings) or planning the order of work for the panel reskin."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 275569c
related_files:
  - docs/design/ui-style.md
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - apps/desktop/src/renderer/panel/views/Mon.tsx
  - apps/desktop/src/renderer/panel/views/Leaderboard.tsx
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - apps/desktop/src/renderer/panel/views/Settings.tsx
  - apps/desktop/src/renderer/panel/panel.css
---

# Panel redesign specs

Per-tab layout for the visual language in `docs/design/ui-style.md`, inside the fixed 440x660 panel
window. Owner feedback per tab: Mon "generally liked" (keep structure, fix chrome and the moves list);
Leaderboard "looks like a web app, want it to look more like a game"; Battles "way too much like an
info web page ... the skill tree should be an actual tree"; Settings "fine for now."

## Mon

```
┌ 440 ───────────────────────────────────┐
│ ┌ hero (nation-tinted) ───────────────┐│
│ │ [sprite]  Mossling  Baby  Lv4 ★rare ││
│ │  88x88    Earth · steady & reliable ││
│ │           [seg][seg][seg]...[XP bar]││
│ │           630 / 1015 XP to Lv 5     ││
│ └──────────────────────────────────────┘│
│ [HP gem][ATK gem][DEF gem][SPD gem]     │
│ KNOWN MOVES · 3/6 unlocked              │
│  [Moss Pat · neutral chip]              │
│  [Root Bind · earth chip]               │
│  [terraform apply · earth chip]         │
│  [··· 3 more moves to discover ···]     │
│ STREAK & TRAINING                       │
│  ★ 4-day streak                         │
│  ● Claude Code connected ...            │
├──────────────────────────────────────────┤
│ [MON*] [BOARD] [BATTLE] [SETUP]  <- nav │
└──────────────────────────────────────────┘
```

- **Components**: hero card (sprite + name/stage/level/rarity badges + segmented XP bar), 4 stat gems,
  known-moves type-colored chip list with a locked-count teaser (no names/stats for locked moves —
  `p.level < m.unlocksAt` already gates this in `apps/desktop/src/renderer/panel/views/Mon.tsx`, only
  the *rendering* changes from a full list with "(Lv N)" suffixes to unlocked-only + a count), streak
  flame + training status line, bottom game-menu bar.
- **States**: egg (no species yet) — hero shows the egg sprite and "Unhatched", stats/moves sections
  are replaced by the existing "what could hatch" species-odds list, no known-moves section at all;
  loading — none, `UiSnapshot` is always available synchronously once the panel mounts; error — none
  (this tab has no network call of its own).
- **Fits without scrolling**: hero, gems, and known-moves (up to 6 unlocked chips + teaser) at typical
  levels. **Scrolls**: the streak/training card if a mon has its full 6 moves unlocked (adult, high
  level) pushes it below the fold — acceptable, it is the least time-critical element on the tab.

## Leaderboard

```
┌ 440 ───────────────────────────────────┐
│ NATION STANDINGS · WEEK                 │
│ ┃WATER  12,480 XP  42 trainers [▓▓▓░]  │
│ ┃EARTH   9,120 XP  38 trainers [▓▓░░]  │
│ ┃FIRE    8,900 XP  35 trainers [▓▓▓░]  │
│ ┃AIR     7,600 XP  30 trainers [▓░░░]  │
│ TRAINERS          [WEEK*][ALL-TIME]    │
│      (2nd)   (1st)   (3rd)             │
│    [sprite] [sprite] [sprite]          │
│    name/xp   name/xp  name/xp          │
│ #4  Daedalus   Boulderbyte Lv10  2,205 │
│ #5  You ★      Mossling Lv4        630 │
│ #6  Riftpatch  Puffle Lv6         598  │
├──────────────────────────────────────────┤
│ [MON] [BOARD*] [BATTLE] [SETUP]         │
└──────────────────────────────────────────┘
```

- **Components**: 4 nation banner tiles (left crest-colored edge bar, crest chip, weekly XP as a big
  display-font number, member/hatched count, a tiny win-rate bar — `weekly_battles_won` /
  `weekly_battles_lost` from `LeaderboardPayload`, same data
  `apps/desktop/src/renderer/panel/views/Leaderboard.tsx` already computes), a week/all-time pixel
  segmented toggle, a top-3 podium (pedestal
  height ranks 1st tallest/center, sprite on each pedestal, name + xp beneath), compact rows for rank 4+
  with the player's own row (`mine`) highlighted in `--accent`.
- **States**: offline build (`!s.online.configured`) — unchanged placeholder message, no banners/board
  at all; loading (`data === null` before first fetch) — a placeholder line, banners/podium do not
  render partially; error (`data.error` set) — keep the existing inline "Could not refresh: ..." line
  under the Trainers header, banners still render from whatever `data.nations` last held; empty
  (`filtered.length === 0`) — existing "Nobody here yet" copy, podium is skipped entirely rather than
  showing 3 empty pedestals.
- **Fits without scrolling**: the 4 banner tiles and the podium. **Scrolls**: the compact trainer rows
  below the podium — this is intentional, it is the "keep scrolling for more" list and does not need to
  fit, unlike the podium which is the tab's visual anchor.

## Battles

```
┌ 440 ───────────────────────────────────┐
│ ┌ arena ──────────────────────────────┐│
│ │ [Mossling]   VS   [Wild Wispit]     ││
│ │  Lv4 Bulwark      Lv5 Bulwark       ││
│ │ WON · 6 turns · knockout            ││
│ │ [09:42 timer]  ★x3 streak  42/50    ││
│ └──────────────────────────────────────┘│
│ LOADOUT                                 │
│  1 Opener   Moss Pat        [neu] ↕    │
│  2 Default  Root Bind       [ETH] ↕    │
│  3 Finisher terraform apply [ETH] ↕    │
│ STANCE                                  │
│      Fury                               │
│  Bulwark* — Gale   (triangle, lit)     │
│ TALENTS · EARTH            🍃18/47     │
│   (SVG tree: 3 branches x 6 tiers,     │
│    trunk at bottom, ranked=filled)     │
│ RECENT OPPONENTS                        │
│  Wild Wispit  WON +20xp  · hint line   │
│  Riftpatch    LOST +10xp · hint [Counter]│
├──────────────────────────────────────────┤
│ [MON] [BOARD] [BATTLE*] [SETUP]         │
└──────────────────────────────────────────┘
```

- **Components**:
  - **Arena header**: player-mon sprite vs. last opponent's sprite with a "VS" divider, a result banner
    (win/loss + turn count + `reason`), a pixel/digital-readout cooldown timer, win-streak flame, and
    challenges-remaining-today count — consolidates the existing "How to battle" `kv` block into one
    game-styled header instead of a plain key-value grid.
  - **Loadout**: 3 slot cards (Opener/Default/Finisher per `SLOT_LABELS` in
    `apps/desktop/src/renderer/panel/views/Battles.tsx`), each a move name + its type chip
    (`docs/design/ui-style.md` chip spec) + up/down reorder buttons — same `reorder`/`setSlot` logic
    already in `LoadoutEditor`, just restyled as cards instead of a `<select>` list; the move dropdown
    itself can stay a native `<select>` inside the card for now (see Implementation plan, this is a
    lower-risk follow-up, not blocking the tree work).
  - **Stance**: an SVG triangle, one corner per stance (Fury/Bulwark/Gale per
    `docs/design/progression.md` Stances), the active stance's corner filled solid in `--accent`, the
    other two dim — replaces the current 3-button list.
  - **Talent tree**: an SVG with a trunk rising into 3 branch columns (one per nation branch, e.g.
    Tremor/Canopy/Foundation for Earth — `docs/design/talent-tree.md`), 6 circular nodes per branch
    connected by a vertical line, tier 1 nearest the trunk (bottom) rising to the tier-6 capstone (top).
    A ranked node is filled in the nation color; a locked node (rank 0 or prereq unmet) is dim/outline
    only. Hover (desktop) or tap (the panel is mouse-driven, but a tap-to-show-tooltip fallback costs
    nothing) shows the node's name, cost and effect — the same data `TalentsSection` in
    `apps/desktop/src/renderer/panel/views/Battles.tsx` already has via `node.description`/`node.cost`.
    A leaf-shaped badge shows the point counter (`spent.nation / nationBudget`). Shared passives keep
    their existing flat button-list treatment (restyled, not redrawn as a tree — they are a separate
    pool with no tiers to visualize, per `docs/design/talent-tree.md` Shared passives).
  - **Recent opponents**: unchanged data (`explainMatchup`, `docs/design/progression.md` Phase D),
    restyled as compact strips (name, win/loss, one hint line, "Counter this" button only when
    `suggestedStance` is set) rather than the current bordered-card-per-opponent block.
- **States**: egg (`hatched === false`) — arena/loadout/stance/tree are replaced by the existing
  "Hatch your mon to pick its moves and stance" line, only Recent opponents can still render (an egg
  can't battle but a previous mon's history — none in practice, list is empty); loading — none, battle
  state is part of `UiSnapshot`; error — the loadout editor's own inline `err` message on a failed save
  is unchanged; empty recent-opponents — existing "No battles yet" line.
- **Fits without scrolling**: arena header + loadout + stance triangle, at typical panel height.
  **Scrolls**: the talent tree and recent-opponents sections — the tree alone (6 tiers x 3 branches
  plus the trunk) is taller than the remaining budget once the arena/loadout/stance render, same
  constraint the current `.loadout-card` overlay already documents (`apps/desktop/src/renderer/panel/
  panel.css`'s "can push this overlay past the panel's 440x660 size" comment). Keep the hidden-scrollbar
  treatment that comment describes, but see Risks below — a tree that must scroll to be read at all is
  a real regression risk, not just cosmetic.

## Settings

Re-skin only — same rows and logic in `apps/desktop/src/renderer/panel/views/Settings.tsx`, no new
components beyond what `docs/design/ui-style.md` already defines generically (bevelled `.card` wrapper
per section, pixel toggle switch instead of the current on/off button, segmented pixel control for
sprite scale, same account/profile/about content). No ASCII sketch needed — the existing row-per-setting
layout is unchanged, only chrome.

- **States**: unchanged from today (offline build hides the account section, hook status dot colors are
  unchanged, update button states are unchanged).
- **Fits without scrolling**: unchanged from today — Settings already scrolls on a full account section
  plus About; that is existing, accepted behavior, not something this pass needs to fix.

## Implementation plan

1. **Style tokens + shared components first.** Add `--ink`/`--parchment`, the `--sp-*` spacing scale,
   and the bundled display font to `apps/desktop/src/renderer/ui/theme.css`; build the shared pieces
   every tab reuses — the bevelled `.card`, stat gem, segmented bar, type chip, and the bottom
   game-menu bar (replacing `.tabs` in `apps/desktop/src/renderer/panel/panel.css`) — before any tab's
   own layout, so every tab consumes the same primitives instead of styling itself independently
   (the root cause of today's "not intentional" look).
2. **Battles next** — it needs the most new drawing (arena header, stance triangle SVG, talent tree
   SVG) and the owner called it out as the worst offender ("not game-like at all"); doing the hardest
   piece first surfaces whether the tree fits the height budget before the simpler tabs are restyled
   around an assumption that turns out wrong.
3. **Mon** — mostly restyling existing structure (hero/gems already close to the target shape) plus the
   moves-list unlocked-only change; low risk, reuses every shared component from step 1.
4. **Leaderboard** — the podium and banner tiles are new components but pure presentation over data the
   view already fetches; no new data plumbing.
5. **Settings** — re-skin last, lowest risk and explicitly "fine for now" per owner feedback.

**Reused as-is (data/logic, not visuals)**: `SpriteView` (`apps/desktop/src/renderer/ui/SpriteView.tsx`)
for every sprite placement; `explainMatchup`/`topBranch`/`toRoman` (`packages/shared`) for Recent
opponents; `TalentsSection`'s `addRank`/`removeRank`/`togglePassive` logic for the tree's click
handling; `LeaderboardPayload` and the existing `load()`/polling in
`apps/desktop/src/renderer/panel/views/Leaderboard.tsx`.

**Risks**:
- **Panel height budget.** The window is fixed at 440x660 (not user-resizable) — every "fits without
  scrolling" claim above must be checked against real font metrics and OS text-size settings, not just
  the mockup's placeholder data; a locale with longer nation/species names could push a supposedly
  fixed-height header into wrapping.
- **Talent tree scrolling.** Per Battles' notes above, the tree plus recent-opponents scrolling below
  the fold is acceptable, but if the tree itself doesn't fit its own allotted space without scrolling
  *within* the loadout editor overlay, a tiered-tree metaphor (rising upward) reads worse cut off
  mid-branch than the current flat 3-column grid does cut off mid-row — worth a real-device check before
  calling this done, not just the static HTML mockup.
- **Editor overlay scrolling.** The loadout editor already hides its scrollbar
  (`apps/desktop/src/renderer/panel/panel.css` `.loadout-card`) while remaining scrollable; a taller SVG
  tree makes that hidden-scrollbar-but-scrollable state more load-bearing, so it needs an explicit
  visual affordance (e.g. a bottom fade) so a player does not miss content below the fold, rather than
  relying on the current no-visible-scrollbar treatment silently.
- **Local font loading.** The bundled display font must resolve with zero network access in the packaged
  Electron app (CLAUDE.md's general no-network-dependency posture for anything on the hot path); verify
  with the app fully offline, not just in dev with hot reload running.
