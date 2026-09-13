---
doc_type: decision
purpose: "Read this when questioning why the panel, onboarding wizard, hover card and water reminder share one pixel-game visual language instead of each styling itself, or why the tab bar moved to the bottom of the panel."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
  - docs/design/ui-style.md
  - docs/design/ui-panels.md
  - apps/desktop/src/renderer/ui/theme.css
  - apps/desktop/src/renderer/ui/BottomTabBar.tsx
  - apps/desktop/src/renderer/ui/PixelPanel.tsx
  - apps/desktop/src/renderer/ui/SegmentedBar.tsx
  - apps/desktop/src/renderer/ui/StatGem.tsx
  - apps/desktop/src/renderer/ui/TypeChip.tsx
  - apps/desktop/src/renderer/ui/NationBadge.tsx
  - apps/desktop/src/renderer/ui/Glyph.tsx
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
  - CHANGELOG.md
adr_status: accepted
---

# Game-style panel UI

## Context

Before this redesign, the panel's four tabs (Mon, Leaderboard, Battles, Settings), the onboarding
wizard, the hover card and the water reminder each chose their own borders, radii, fonts and
colors independently. Nothing enforced a shared visual language across them, and the panel had
drifted toward flat rows, a soft 6px radius, one thin hairline border everywhere, a single sans
font and an unsegmented gradient XP bar — a look indistinguishable from a generic settings web
page, at odds with the app's own desktop-pet/Pokémon-like premise. Owner feedback on this state was
blunt: "it looks vibe coded, bloated and not intentional," and, tab by tab, "looks like a web app,
want it to look more like a game" (Leaderboard) and "way too much like an info web page ... the
skill tree should be an actual tree" (Battles). The concrete before/after per surface is recorded in
`docs/design/ui-style.md` (tokens and shared chrome rules) and `docs/design/ui-panels.md` (per-tab
layout); this ADR only records that the reskin was undertaken and why, not the specifics.

## Decision

Replace the independently-styled screens with one small, reused set of game-styled tokens and
components, landed in `apps/desktop/src/renderer/ui/`: `PixelPanel`, `SegmentedBar`, `StatGem`,
`TypeChip`, `NationBadge`, and `Glyph` (an 8x8 pixel icon set replacing every emoji, since emoji
render inconsistently across fonts and platforms). The panel's top tab strip is replaced by a
`BottomTabBar` game-menu bar, read as a console/handheld menu rather than a browser-style tab strip
and kept clear of the header elements (hero card, arena, banner tiles) that now do most of the
"this is a game" work at the top of each tab. Headings, labels and numerals use a bundled,
OFL-licensed pixel display font, Pixelify Sans, loaded from a local `.woff2` file with no network
request (the packaged app has no guaranteed network access). Battles' flat stance buttons and
talent button-lists are replaced by SVG drawings: a stance triangle, and a talent tree with a trunk
rising into three branches, tiered nodes rising upward toward each branch's capstone. See the
`[0.2.0]` entry in `CHANGELOG.md` for the shipped description and commit.

## Consequences

- The pixel display font is illegible below about 12px — a real capture of the Mon tab's move
  count was misread ("2/6" as "8/6") because Pixelify Sans's digit shapes collapse at small sizes.
  Rather than a soft cutoff, every exact count, level or rank rendered at 11px or below (badges,
  chip labels, tab labels, the talent tree's rank pips, the stance triangle's corner labels) now
  falls back to the bold system font; the display font is used only at 12px and up. This threshold
  is recorded as the current rule in `docs/design/ui-style.md`, not re-derived here.
- The four screens now share one small vocabulary of shapes and tokens instead of each inventing
  its own, at the cost of every future screen needing to fit that vocabulary (diamond stat gems,
  segmented bars, 2px bevelled cards) rather than choosing its own chrome.
- The panel windows are a fixed compact size (`docs/decisions/0018-compact-window-and-fail-closed-click-through.md`),
  so the redesign had to fit every tab's new, taller header-first layout inside that same fixed
  height budget; the talent tree in particular is taller than the remaining Battles-tab budget once
  the arena header, loadout and stance triangle render, and scrolls below the fold as a deliberate
  trade rather than a fixed-height regression.
- Exercising every sprite placement for the first time during this pass's visual-capture step
  surfaced an unrelated, pre-existing bug — evolved mons rendered no sprite at all, because
  `spriteIdFor` built ids off the wrong species name — fixed in the same `[0.2.0]` release rather
  than blocking the reskin on it.

## Status

Accepted, 2026-09-13
