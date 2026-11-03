## Colour

Ten standard roles carry every screen: `canvas` (the page), `panel` (dialogs, popovers, cards), `tile` (quiet fills and hover), `line` (hairline rules, never a control border), `control-border` (inputs, outlined buttons, the day's box), `ink` (text, icons and the primary button's fill), `on-ink`, `ink-secondary` (dates, goals, hints), `error-ink` and `focus`.

Four project roles each mean exactly one thing:

| Role | Means | Never |
| --- | --- | --- |
| `pen` | Great: a day's fill, the year strip's dots, a day that met the daily pick (its name, underlined, K60), and a week that met an item's goal (its count in RecentWeeks, underlined, K64) | Links, buttons, decoration |
| `pen-partial` | Partly done: a day's fill | Over the pick, warnings |
| `pen-missed` | Tried and couldn't: a day's fill | Errors |
| `caution-ink` | A caution, always with words; nothing on the planner uses it since the Picked row went (K28) | Errors |

**The three pens** are fixed, like the green, yellow and red markers by a whiteboard; nobody picks them. The pen is what tells the three kinds apart on screen (K15); the accessible name says "partly done" or "couldn't do it". `pen` reaches 4.5:1 as text on `canvas` and `panel`, and `pen` and `pen-missed` reach 3:1 as a mark on `canvas`, `panel` and `tile`, in both themes. `pen-partial` is a sunny yellow by the owner's choice (K18): 1.5–1.9:1 on the light grounds, held to 1.5:1 by the gate, and above 7:1 in dark. The box drawn over every mark keeps it findable. In dark the pens are vivid, a grass green, a sunflower yellow and a tomato red (K22).

**Today** has no band (K36): every day looks alike, and only the accessible name says "today".

**Print** is the light theme on white paper, from either theme: words, boxes and marks keep their light colours, the surfaces go transparent and chips are outlined (K16).

## Type

The type is set for the gym, not the desk: big enough to read at arm's length from a phone propped on a bench (K19). Nothing is delicate.

**Source Serif 4** for the display date, section titles, the wordmark and notes (italic). **Source Sans 3** for everything else, numbers included, always with `font-variant-numeric: tabular-nums`. Both self-hosted.

**Monospace** (`--font-mono`, the system's own monospace face, nothing downloaded) only for text read character by character and copied: a token and its prefix, the MCP address and the commands in Settings › Connections. Never for numbers, labels or anything else.

| Style | Size | Use |
| --- | --- | --- |
| `display` | 44/48 serif 600 (36/40 below 640px) | The week's date, on paper only (visually hidden on screen, K54) |
| `title-1` | 30/36 serif 600 | Section titles |
| `title-2` | 22/28 sans 600 | Dialog titles |
| `body-large` | 20/28 | Larger running text, row names (600) |
| `body` | 18/26 | Running text, inputs, buttons |
| `caption` | 16/22 | Goals, hints, dates in `ink-secondary` |
| `label` | 16/22 600 | Field labels, chips (a WeekGrid row's at 18, K46). Day names ("Mon") take the weight at the rows' name size, max(20px, 27u) (K60). Sentence case. |
| `note` | 18/26 serif italic | A person's note |

## The marks

- **Empty:** the box, drawn by hand in `control-border`. On screen it fills 86% of its cell, up to 128px (K24); on paper it is about 45px across in a 76px cell.
- **Great, partial, missed:** the box filled in `pen`, `pen-partial` or `pen-missed` with one of three marker drawings traced from the owner's own ink (an open zigzag, a solid fill, a dense hatch). The box is drawn over the fill. The ink runs a little past the box, as a quick hand does, and every kind counts towards the week.
- **A press** chooses both, drawing first (K17): an exercise's day goes great, partial and missed in the zigzag, then in the solid, then in the hatch, then back to empty; a food goes great in each drawing, then empty. The drawing is saved with the day.
- **Mark sets:** Settings' **Marks** chooses how a marked day is drawn on this device (K20): the squiggles above, **Ticks** (a tick, a circle, a cross), **Faces** (happy, so-so, sad), or either **Stamped**, the box coloured in solid with the symbol in paper. Ticks and faces are a marker stroke in the pen, the box drawn over it. A set changes only the look; in a tick or face set a press steps great, partial, missed, then empty (K21).
- **Today:** "today" in the accessible name; nothing on screen (K36).
- **Note:** a small `ink-secondary` mark in the cell's top-right corner; "has a note" in the accessible name.
- **A day that meets the daily pick:** its name in `pen`, underlined (K30, K60). Nothing else marks it.

## Shape and depth

Hairline `line` rules, almost no shadow. Radius `radius-sm` 4px (fields, tiles, chips), `radius-md` 6px (buttons), `radius-lg` 10px (panels), `radius-full` (the Switch, the year strip); a day mark is drawn by hand, with no radius token. `shadow-overlay` on dialogs and the popover in light; none in dark. Spacing on a 4px base, `space-1` to `space-16`.

## Focus and motion

Every interactive element shows a solid 2px `focus` outline at 2px offset, never clipped. Colour transitions last 120ms at most and stop under `prefers-reduced-motion`. Nothing celebrates.

## Icons

Lucide outline icons at 1.5px stroke, 20px in buttons and 16px beside text, in `currentColor`. An icon-only button always has an accessible label and a 44px hit area.
