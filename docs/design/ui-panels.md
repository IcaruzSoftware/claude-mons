---
doc_type: design
purpose: "Read this when redesigning a specific panel tab (Mon, Leaderboard, Battles, Settings) or planning the order of work for the panel reskin."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
  - docs/design/ui-style.md
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - docs/decisions/0019-game-style-panel-ui.md
  - apps/desktop/src/renderer/panel/views/Mon.tsx
  - apps/desktop/src/renderer/panel/views/Leaderboard.tsx
  - apps/desktop/src/renderer/panel/views/leaderboardHelpers.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - apps/desktop/src/renderer/panel/views/battleTreeLayout.ts
  - apps/desktop/src/renderer/panel/views/Settings.tsx
  - apps/desktop/src/renderer/panel/onboardingSteps.ts
  - apps/desktop/src/renderer/panel/panel.css
---

# Panel redesign specs

**Status: shipped** in the 0.2.0 "game-style panel redesign" (commit `6d1d1c3`) — all four tabs,
the shared components and the game-menu bar landed; see
`docs/decisions/0019-game-style-panel-ui.md` for the decision record. Deviations found during the
build-order's visual-capture step, still accurate against the shipped code:

- **Battles: stance triangle and talent tree are read-only previews on the main tab, interactive
  only inside the loadout editor overlay.** This doc's ASCII sketch shows the triangle and tree
  directly on the Battles tab with no overlay; the *implementation* kept the existing
  `LoadoutEditor` overlay (opened via "Edit loadout" or "Counter this") as the place moves, stance
  and talent ranks are actually changed, and added a static (non-clickable) `StanceTriangle`/
  `TalentTree` preview of the *saved* loadout directly on the main tab so the tab still reads at a
  glance the way the sketch shows. Reason: "Keep all existing behaviour and IPC calls (set-loadout,
  stance, tree, respec, validation messages, Saved confirmation, disabled reasons)" is a stronger
  constraint than the sketch's exact layout, and the editor's Save/Cancel/respec-confirm state
  machine (`apps/desktop/src/renderer/panel/views/Battles.tsx`'s `LoadoutEditor`) is exactly that
  existing behaviour. Both the preview and the editor render through the same `StanceTriangle`/
  `TalentTree` components (interactivity is just an optional `onPick`/`onAdd`/`onRemove` prop), so
  there is one implementation of each, not two.
- **Sprite bug found during this pass, fixed in the same 0.2.0 release (not by this doc).**
  Visually capturing the Mon hero, Battles arena and (by extension) the Leaderboard podium
  surfaced that every mon past baby stage rendered a blank sprite: `spriteIdFor`
  (`packages/sprites/src/index.ts`) built `${speciesId}-${stage}`, but the sprite package
  registers teen/adult art under the *evolved* species' own name (e.g. `rootling-teen`, not
  `mossling-teen`). `packages/sprites/src/index.ts` now carries an explicit `EVOLUTION_LINES`
  table so `spriteIdFor` maps a base species + stage to the right evolved-form art (see
  CHANGELOG 0.2.0). `apps/desktop/src/renderer/ui/SpriteView.tsx` also stayed defensively hardened
  so an unresolvable sprite id sizes its canvas to the standard 32px grid instead of the browser's
  300×150 default, which otherwise blew out every flex layout it sat inside (the hero slot, the
  arena's side columns) with a huge invisible box.
- **Leaderboard's populated state (banners/podium/board rows) was verified live after this pass.**
  The podium/banner code was originally checked only by review and by `podiumOrder`'s unit tests
  (`apps/desktop/test/leaderboardHelpers.test.ts`) against an offline placeholder build; against
  real backend data it also surfaced that battles from since-deleted (orphaned) challenger
  accounts inflated a nation's tallies and drew a full win bar on a tile with no real trainers.
  Commit `8a24ac9` excludes orphaned battles server-side and has `LeaderboardView`
  (`apps/desktop/src/renderer/panel/views/Leaderboard.tsx`) render a `"no battles yet"` label
  instead of a `winbar` when a nation's `weekly_battles_won + weekly_battles_lost` is 0 — see the
  Leaderboard section below.

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

- **Components**: 4 nation banner tiles (`NationBadge` crest chip, weekly XP as a big display-font
  number, `{hatched}/{members} trainers · avg Lv N` line, a tiny win-rate bar — `weekly_battles_won`
  / `weekly_battles_lost` from `LeaderboardPayload`, same data
  `apps/desktop/src/renderer/panel/views/Leaderboard.tsx` already computes), a week/all-time pixel
  segmented toggle, a top-3 podium (`podiumOrder` in
  `apps/desktop/src/renderer/panel/views/leaderboardHelpers.ts` orders it 2nd/1st/3rd left-to-right;
  pedestal height ranks 1st tallest/center, sprite on each pedestal, name + xp beneath), compact rows
  for rank 4+ with the player's own row (`mine`) highlighted in `--accent`.
- **Win bar can be legitimately absent.** A tile only draws the `winbar` fill when the nation has
  logged battles this week (`weekly_battles_won + weekly_battles_lost > 0`); a nation with no
  battles (or, per commit `8a24ac9`, only orphaned-account battles now excluded server-side) shows
  a `winbar-empty` `"no battles yet"` label instead of a bar at 0% — an empty bar would otherwise
  misread as "this nation is losing everything" rather than "this nation hasn't played."
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
    already in `LoadoutEditor`, restyled as cards instead of a flat `<select>` list. The move picker
    itself stays a native `<select>` inside each card (shipped as-is; restyling that control further
    is not planned).
  - **Stance**: an SVG triangle, one corner per stance (Fury/Bulwark/Gale per
    `docs/design/progression.md` Stances), the active stance's corner filled solid in `--accent`, the
    other two dim — replaces the current 3-button list.
  - **Talent tree**: an SVG with a trunk rising into 3 branch columns (one per nation branch, e.g.
    Tremor/Canopy/Foundation for Earth — `docs/design/talent-tree.md`), 6 circular nodes per branch
    connected by a vertical line, tier 1 nearest the trunk (bottom) rising to the tier-6 capstone (top).
    A ranked node is filled in the nation color; a locked node (rank 0 or prereq unmet) is dim/outline
    only. Hovering a node (a click also selects, covering the tap case) shows its name, rank,
    cost/rank and effect in a `talent-tooltip` line below the tree; a left click adds a rank and a
    right click removes one when the tree is interactive (`onAdd`/`onRemove` supplied). Node x/y
    coordinates come from the pure, unit-tested `treeNodePosition`
    (`apps/desktop/src/renderer/panel/views/battleTreeLayout.ts`). A `leaf`-glyph badge shows the
    point counter (`spent.nation` / `pointsAvailable(level)`). Shared passives keep their existing
    flat button-list treatment (restyled, not redrawn as a tree — they are a separate pool with no
    tiers to visualize, per `docs/design/talent-tree.md` Shared passives).
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
  plus the trunk) is taller than the remaining budget once the arena/loadout/stance render. The
  scroll area (`.view` in `apps/desktop/src/renderer/panel/panel.css`) hides its native scrollbar
  and instead pins a `scroll-fade` sibling (rendered by `apps/desktop/src/renderer/panel/App.tsx`)
  above the game-menu bar as the visual cue that there is more to see.

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

## Other screens sharing these tokens

CHANGELOG 0.2.0 also reskinned three screens outside the four-tab panel with the same
`docs/design/ui-style.md` tokens/components (no ASCII sketch here — each is a small, single-purpose
window, not a tab):

| Screen | File(s) | Shared pieces used |
|---|---|---|
| Onboarding wizard | `apps/desktop/src/renderer/panel/views/Onboarding.tsx`, step arithmetic in `apps/desktop/src/renderer/panel/onboardingSteps.ts` | `--font-display` for step headings and nation titles, `SpriteView`, `AccountEmailCode`; account-linking copy is centralized in `apps/desktop/src/renderer/panel/accountCopy.ts` (shared with Settings' Account section) |
| Hover card | `apps/desktop/src/renderer/hovercard/main.tsx`, `apps/desktop/src/renderer/hovercard/hovercard.css` | Imports `apps/desktop/src/renderer/ui/theme.css` directly; keeps its own compact DOM/legacy `.bar` fill (`docs/design/ui-style.md` calls this out as the one place the pre-redesign segmented-bar look intentionally remains) but re-textured to the bevelled chrome and `--font-display` name label |
| Water reminder | `apps/desktop/src/renderer/reminder/main.tsx` | `SpriteView` (or a `Glyph name="drop"` fallback before a mon has hatched), `button.primary` chrome |

## Build order and follow-ups (historical)

Built in dependency order: tokens/shared components first (`apps/desktop/src/renderer/ui/theme.css`,
the pieces in the Shared components table), then Battles (most new drawing, and the owner's most
critical feedback), then Mon, then Leaderboard, then Settings last (lowest risk, "fine for now" per
owner feedback). `SpriteView`, `explainMatchup`/`topBranch`/`toRoman` (`packages/shared`), and
`LeaderboardPayload`'s existing `load()`/polling carried over unchanged from before the reskin.

Two risks flagged before the build were resolved by the ship: the panel height budget held at real
font sizes (no reported wrapping), and a taller scrolling section (the talent tree, a long moves
list) got the `scroll-fade` visual affordance described under Battles above instead of shipping
with no cue at all. The bundled Pixelify Sans font
(`apps/desktop/src/renderer/ui/fonts/PixelifySans.woff2`) loads with zero network request, per
CHANGELOG 0.2.0.
