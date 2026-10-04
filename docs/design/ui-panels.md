---
doc_type: design
purpose: "Read this when redesigning a specific panel tab (Mon, Leaderboard, Battles, Settings) or planning the order of work for the panel reskin."
audience: agent
last_verified: 2026-10-04
last_verified_commit: a197357
related_files:
  - docs/design/ui-style.md
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - docs/decisions/0019-game-style-panel-ui.md
  - apps/desktop/src/renderer/panel/views/Mon.tsx
  - apps/desktop/src/renderer/panel/views/Leaderboard.tsx
  - apps/desktop/src/renderer/panel/views/leaderboardHelpers.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - apps/desktop/src/renderer/panel/views/Settings.tsx
  - apps/desktop/src/renderer/panel/onboardingSteps.ts
  - apps/desktop/src/renderer/panel/panel.css
---

# Panel redesign specs

> Verifying a change against these specs: `docs/runbooks/verify-a-ui-change.md`. Class names used by
> the views must exist in a stylesheet those views load — enforced by
> `apps/desktop/test/styleContract.test.ts`.

**Status: shipped** in the 0.2.0 "game-style panel redesign" (commit `6d1d1c3`) — all four tabs,
the shared components and the game-menu bar landed; see
`docs/decisions/0019-game-style-panel-ui.md` for the decision record. Deviations found during the
build-order's visual-capture step, still accurate against the shipped code:

- **Battles: abilities and history stay compact; progression opens in the Skill Tree.**
  Controls hold a local draft. Save persists it; Discard restores the saved selection.
  Move options have readable dark backgrounds and disable moves equipped in another slot.
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

- **Components**: 4 nation banner tiles (`NationBadge` crest chip, scope XP as a big display-font
  number, `{hatched}/{members} trainers · avg Lv N` line, a tiny win-rate bar), a week/all-time pixel
  segmented toggle, a top-3 podium (`podiumOrder` in
  `apps/desktop/src/renderer/panel/views/leaderboardHelpers.ts` orders it 2nd/1st/3rd left-to-right;
  pedestal height ranks 1st tallest/center, sprite on each pedestal, name + xp beneath), compact rows
  for rank 4+ with the player's own row (`mine`) highlighted in `--accent`.
- **One switch drives both sections.** The WEEK / ALL-TIME toggle lives in the Trainers header but
  its `scope` state also selects what the nation tiles show: weekly XP + this week's battle tallies,
  or all-time XP + all-time battle tallies. The tiles re-sort by the selected XP (tie-breaking by the
  other), the header reads `Nation standings · this week` / `· all time`, and the pure
  `nationStanding` / `sortNations` helpers in
  `apps/desktop/src/renderer/panel/views/leaderboardHelpers.ts` do the selection and ordering.
- **Win bar can be legitimately absent.** A tile only draws the `winbar` fill when the nation has
  logged battles in the selected scope (`won + lost > 0`); a nation with no battles (or, per commit
  `8a24ac9`, only orphaned-account battles now excluded server-side) shows a `winbar-empty`
  `"no battles yet"` label instead of a bar at 0% — an empty bar would otherwise misread as "this
  nation is losing everything" rather than "this nation hasn't played." All-time battle counts come
  from the `battles_won` / `battles_lost` columns added in
  `supabase/migrations/20260924052834_nations_alltime_battles.sql`; an older server without them is
  treated as 0.
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

The main Battle view contains Abilities (three attack slots, reorder, Save/Discard), the
Skill Tree entry below the attack explanations and Save/Discard buttons, then Battle History. It has no arena,
separate Talents list, passive list or stance section.

The Skill Tree expands the native window to a centered overview (up to 1920×1120, bounded
by the current display's work area), then restores the compact Battle bounds on close. Only
the map is shown. Wheel zooms around the cursor, drag pans; keyboard focus recenters nodes,
arrow keys pan, +/- zoom, Enter learns and Delete refunds. There is no toolbar or inspector.
Four radial paths each allow twelve purchases along a chosen route (64 nodes total), including
six Flow combos and six mastery purchases per path. Two three-way mastery forks offer offense,
defense or tempo, with one choice per fork. The following skill accepts any chosen alternative.
Every route costs all 47 level-50 nation points.

Stances and main passives occupy separate labelled map regions. Stance shows 1/1 active.
Main passive shows 0/1 or 1/1 chosen and explains the one-slot rule. Each passive group connects
to its required tier-6 nation capstone; other main passives show Slot full while one is chosen.
Normal nation/Flow passives remain combinable. Hover explains cost, prerequisite, effects and
build fit in a tooltip above the cursor, inside the map experience. The core explains the
innate passive and automatic combo. Stances appear exclusively in the map.

Learned nodes and connections glow gold; available nodes and their edges have a weaker
highlight; locked or unaffordable nodes and edges are dimmed. Explicit labels and role icons
identify offense, defense, tempo and elemental bonuses. Larger frames identify passives and
capstones. Role and availability remain understandable without color.

Left click learns/equips and automatically persists. Right click refunds, cascading dependants
and any main passive whose prerequisite was removed. Reset all is unrestricted and saves
immediately. The map has no Save/Cancel. Edits serialize so rapid clicks cannot overwrite a
newer allocation; failure restores confirmed state and shows a retry message. Attack drafts
remain separate. The point HUD, reset, close and brief interaction hint are part of the map.

History shows the ten newest battles, sorted by their original timestamps. Resolved
battles persist before animation ends and update the open panel immediately. Startup,
account sign-in and sync read the account's latest 50 challenger/defender battles through
existing participant-only RLS, merging by id with local offline fights. Same-account
sign-in preserves cached history; switching accounts clears it. Failed fetches keep the
cache. Late fetches cannot populate a different account.

At 380×520, the map remains the entire view; zoom and pan expose every region without document overflow.
The main view scrolls its history. An egg shows the hatch prompt and empty history.
Save errors retain drafts for retry.

References: [Path of Exile](https://www.pathofexile.com/passive-skill-tree) and
[Last Epoch](https://lastepoch.com/skills/).

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

The welcome sign-in action uses the shared secondary button at the 13px body size, with its light
text and keyboard focus ring. A browser-default blue anchor on the dark background fails contrast.

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
