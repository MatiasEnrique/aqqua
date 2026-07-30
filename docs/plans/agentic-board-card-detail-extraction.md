# Agentic Board card detail — Paper extraction (V3-i1a/b/c)

Exact values pulled from the three Paper artboards with the Paper MCP tools
(2026-07-30). Companion to `agentic-board-ui-prototypes.md` (intent) and
`agentic-board-tickets.md` (scope). Values are the dark-mode renders of the
app's real tokens — map every hex back to the matching semantic token from
`apps/web/src/index.css`; never hardcode these.

Layout (1440×900 reference): app sidebar 384px (existing, unchanged) · main
1056px = 52px existing top bar + body. Body = **tree rail 264px** (`w-66`,
`border-r white/6%`, `pt-4 pb-3 px-3`, rows gap 0.5) + **detail slot** (grow;
message column `w-184` = 736px centered, matching the chat surface).

## Tree rail (the card tree)

Header: `PIPELINE · 3 STEPS` — 10px/12 bold, tracking-widest, `#6E6E6E`
(muted), `pb-2.5 px-2`.

Step row (top level): h-30px (`h-7.5 px-2 rounded-lg gap-2`):

1. chevron slot `w-3` — 10px chevron `#6E6E6E` (right = collapsed, down = expanded; stroke-width 3)
2. status icon slot `w-3.5` — 14px icon (see icon map below)
3. name `1 · Plan` — 13px/16 DM Sans font-medium, `#A3A3A3`; **selected step**: font-semibold `#F5F5F5` + row bg `#191919` (popover token)
4. trailing mono `8m · $0.52` — 10px/12 JetBrains Mono `#5C5C5C` (selected: `#828282`)

Leaf rows (one indent): h-26px (`h-6.5 pr-2 pl-7.5 rounded-lg gap-2`), icon slot `w-3` 12px icon:

- **Sub-agent thread**: 12px status circle-check `#34D399`; name 12px/16 `#A3A3A3`; trailing `14m` mono 10px `#5C5C5C`.
- **Diff**: file-diff icon `#5C5C5C`; `14 files changed` 12px `#828282`; trailing `+214 −31` mono `#5C5C5C`.
- **Artifact**: file icon (`#5C5C5C`; amber `#FBBF24` when draft/current); name `implement.md` JetBrains Mono 11px/14 `#828282` (current step's: `#D4D4D4`); trailing `3.4 KB` mono 10px `#5C5C5C`, or `draft` in amber `#FBBF24`.
- **Done terminal row**: h-7.5, empty chevron slot, 14px clock icon `#5C5C5C`, `Done` 13px `#5C5C5C`, trailing `not reached` 11px `#5C5C5C`.

Icon map = the app's `SidebarStatusPresentations.tsx` icons at board badge
colors: CircleCheck emerald `#34D399` done · CircleAlert amber `#FBBF24`
needs-input/paused · CircleDashed working · Clock `#5C5C5C` idle/not reached.
Fixture shows step 1 collapsed (chevron affordance visible), step 3 selected +
expanded with its sub-agents, `review.md` (draft) leaves.

## Detail slot — state a (step thread selected)

Existing chat surface, 736px column, `pt-4 px-5`:

- User bubble (the rendered step prompt): right-aligned, `max-w-147` (588px), `p-3 rounded-[18px]`, bg `#FFFFFF0A` (accent bubble token), text 14px/23 `#F5F5F5`.
- Assistant text: bare left text 14px/23 `#F5F5F5CC` (`text-foreground/80`), `px-1`, paragraphs gap-2.5.
- Work rows (sub-agent spawn, file write): `p-0.5 rounded-lg gap-1.5`, 20px icon slot (14px icon at `rgb(245 245 245 / 92%)`, opacity .8), label 12px/20 font-medium `#F5F5F5D1`, detail 12px `#8181818C` (`correctness sweep` + `sub-agent · 14m · $0.88`; `Write` + `review.md`), trailing 16px slot with 12px check `rgb(129 129 129 / 55%)`.

## Detail slot — state b (sub-agent thread selected)

Same surface. Spawn prompt as the user bubble, `Read <file>` work rows (eye
icon), assistant findings text. Composer is the same shell but the primary is
the **plain 32px circular send** (`rounded-2xl bg-[#366FFB] size-8`, white
up-arrow) — no split button, sub-agents cannot move the card. Per the
prototypes doc add the quiet hint "this thread has already returned; new turns
won't move the card" + a `Re-run sub-agent` affordance in the detail header.

## Detail slot — state c (artifact selected)

The markdown document rendered directly in the same 736px message column — no
card chrome: h1 20px/26 semibold `#F5F5F5`, h2 18px/23 semibold, body/bullets
14px/23 `#F5F5F5CC`, bullet rows `flex gap-2` with `w-3.5` marker slot.
Live-editable in place (caret in text, `editable — type anywhere` / `Saved`
per the doc); provenance entries ("3 · Review wrote this file · 6m ago", "read
by …" with `${artifact}` chips) render as message-like entries around it. No
edit mode, no save button.

## Composer (identical in all three states — the app's real `ChatComposer`)

Shell: `w-184 rounded-[22px] bg-[#101010] border white/5%`; editor min-h-70px
`pt-4 pb-2 px-4`, placeholder 14px `#4A4A4A` ("Ask anything, @tag
files/folders, $use skills, or / for commands"). Toolbar `pb-3 px-3 gap-1`:
model chip (14px provider glyph + `Claude Opus 5` 14px/18 font-medium
`#828282`) · 1px divider `white/6%` · `Medium · 1M` · lock `Full access` ·
`Build` — all h-7 `px-2.5 rounded-[10px]`, transparent until hover. Right:
20px context ring (stroke 3, `#818181` on `rgb(129 129 129/24%)`).

Primary-action slot (`ComposerPrimaryActions` pattern):

- Step thread (waiting): **`Resume ⌄` split button** — h-8, left half `px-4 bg-[#366FFB] rounded-l-2xl` label 12px/16 font-medium white; right half `px-2` chevron, divider `border-l #FFFFFF1F`, `rounded-r-2xl`. `#366FFB` = the primary token `oklch(0.588 0.217 264)`.
- Menu (opens above, right-aligned): `w-58 p-1 rounded-[10px] bg-[#191919] border white/8%`; items h-7.5 `px-2 rounded-md gap-2`, 14px icon + 13px/16 label `#D4D4D4` (hover/first item bg `#FFFFFF0A`, label `#F5F5F5`): `Resume step` (arrow-right) · `Retry step fresh` (rotate-ccw) · `Mark done, go to Done` (check) · divider `h-px #FFFFFF0F` · `Cancel card` (ban icon, **`#FF6467`** destructive).
- Sub-agent thread: plain circular send (above). While a turn runs: the existing red stop button (also = cancel the running step). Typing switches primary to `Send & resume`.

Below the composer: the existing checkout footer bar — `w-173 h-8` bg
`#FFFFFF05`, side/bottom borders `#FFFFFF12`, `rounded-b-2xl`, `Local
checkout` left + branch chip `board/oauth-refresh` right, 12px/16 font-medium
`#818181B3` — the app's existing component, shown with the card's branch.

## Non-goals for the implementing lane

The 384px left rail in the artboards (board row + NEEDS YOU/ACTIVE/TO-DO/
SETTLED card groups, board-switcher popover) is contextual dressing — the app
sidebar stays as-is in this ticket. Top bar unchanged. Delete this file when
the card-detail UI ships if the team prefers docs lean.
