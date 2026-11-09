One day of one exercise or food: a box drawn as if on a whiteboard, empty or marked in green (great), yellow (partial) or red (missed) in the device's mark set, and the button that steps between them.

## Use

- **The box:** drawn by hand, a little uneven, about 45px across: a 60px SVG on a 36-unit square, its path stroked 1.75 units in `control-border` with round caps and joins. The box is the same in every state; marking a day never changes it.
- **The marks:** a marked day fills the box in its pen, with one of three drawings. Each is the outline of the owner's own marker ink, lifted from a photo, straightened onto the box and traced (K17), so it is filled, not stroked, with `fill-rule: evenodd` for the paper between strokes:

  | Drawing | Look |
  | --- | --- |
  | Open zigzag | back-and-forth strokes with a sharp "N" turn at the top right and paper showing between them |
  | Solid | the box coloured in, with a ragged edge just past it |
  | Dense hatch | close diagonal strokes with slivers of paper between them |

  | Mark | Pen |
  | --- | --- |
  | Great | `pen` (green) |
  | Partial | `pen-partial` (sunny yellow) |
  | Missed ("tried and couldn't") | `pen-missed` (red) |

  The pen says which kind a day is; the drawing carries no meaning. The person chooses it by pressing (below), and it is saved with the day, so a day keeps its drawing everywhere: in the week and in an export. A mark is written `great`, `partial` or `missed` for the zigzag, and with the drawing after it for the others: `great-solid`, `missed-hatch`.

  The box is drawn over the fill, as a pen line shows through marker. The ink runs past the box's edges, as if scribbled quickly by hand, so the SVG is `overflow: visible`. The paths are `BOX_PATH` and `MARK_DRAWINGS` in the app's `day-mark/index.ts`; the previews draw the same ones (`data-drawing` picks one, the open zigzag by default).
- **Mark sets** (K20): Settings' **Marks** chooses how a marked day is drawn on this device. **Squiggles**, the default, are the three drawings above. The other four draw one symbol per kind, so each kind has its own shape:

  | Set | Great | Partial | Missed |
  | --- | --- | --- | --- |
  | Ticks | a tick | a circle | a cross |
  | Faces | a happy face | a so-so face | a sad face |

  **Ticks** and **Faces** stroke the symbol in the pen at a marker's width (4.5 units, round ends), with the box drawn over it; the tick's long stroke runs past the box's corner. **Stamped ticks** and **Stamped faces** fill the box with the solid drawing in the pen and draw the symbol in paper (`canvas`, 3.25 units) on it. The paths are `MARK_SYMBOLS` and `markLook` in `day-mark/index.ts`. A set changes only the look: a stored `great-solid` is a tick in Ticks and the solid squiggle again in Squiggles (K21).
- **Empty:** the box alone. A day not marked is an empty box, never a dash or a grey mark.
- Each pen means its mark and nothing else: `pen-partial` is never a warning (that is `caution-ink`), and `pen-missed` is never an error (`error-ink`); a missed day is a record, not a fault.
- **Every kind counts.** Great, partial and missed all count towards the week and towards a day reaching the daily pick: the person showed up.
- **Pressing steps the mark, drawing first** (K17). An exercise goes empty → great, partial, missed in the zigzag → the same three in the solid → the same three in the hatch → empty: nine marks, then empty. A food has one kind: empty → great in the zigzag, the solid, the hatch → empty. In a tick or face set there is one drawing per kind (K21): an exercise goes empty → great → partial → missed → empty, and a food empty → great → empty; a squiggle drawing already there steps on from its kind.
- **Filling a cell** (K24): on screen the WeekGrid makes each day cell a size container, and the button fills 86% of the cell's shorter side, up to 128px, with the drawing at 94% of the button. At 1280×800 that is an 86px button. The rest of the cell is quiet space, so neither the ink past the box nor the focus ring touches a neighbour.
- **The fixed size:** a 64 × 64px button centred in a 76px square cell, with a 60px drawing. Paper uses it, and so does a mark drawn outside a grid (the Marks setting's rows).
- **Today:** no band (K36); the mark looks as on any day, and its name says "today".
- **Note:** a NoteMark (a 10px folded corner in `ink-secondary`) in the cell's top-right corner, flush to the corner. It sits outside the box, never on it.
- The same DayMark sits in the Exercises, Cardio and Food grids, in every layout.
- **Print:** the light theme's colours on white paper, from either theme: the box and the marks keep their light colours (K16). A stamped symbol takes the light `canvas`, since the canvas itself goes transparent. See WeekGrid.

## States

| State | Look |
| --- | --- |
| Empty | the `control-border` box |
| Empty, hover | the box darkens to `ink` |
| Great | the box filled in `pen` |
| Partial | the box filled in `pen-partial` |
| Missed | the box filled in `pen-missed` |
| In a tick or face set | the kind's symbol in its pen, or stamped: the box solid in its pen, the symbol in paper |
| Today | any of the above, named "…, today" |
| Has a note | any of the above plus the folded corner |
| Keyboard focus | solid 2px `focus` outline at 2px offset around the 64px button, never clipped |

A marked box doesn't change on hover. A press draws the next mark at once; the box's hover colour changes in 120ms at most, and not at all under `prefers-reduced-motion`. Nothing celebrates: no pop, bounce, draw-on animation or confetti.

## Accessibility

- A `<button type="button">` with `aria-pressed`, true for any mark, so a screen reader announces the change when a day is marked or cleared. The name says which day of which row; it adds the kind only for partial and missed, since pressed already says a great day is marked:

  | Cell | Accessible name | State |
  | --- | --- | --- |
  | Push-ups, Monday, great | "Push-ups, Monday 19 October" | pressed |
  | Squats, today, great | "Squats, Thursday 22 October, today" | pressed |
  | Squats, today, partial | "Squats, Thursday 22 October, today, partly done" | pressed |
  | Squats, today, missed | "Squats, Thursday 22 October, today, couldn't do it" | pressed |
  | Squats, today, partial, with a note | "Squats, Thursday 22 October, today, has a note, partly done" | pressed |
  | Fish, Saturday, empty | "Fish, Saturday 24 October" | not pressed |

  VoiceOver reads the fifth as "Squats, Thursday 22 October, today, has a note, partly done, toggle button, selected". Write the weekday and the month in full in the name; the visible header can stay "Thu 22".
- Today's mark says so twice: `aria-current="date"` on the button, and "today" in its name. The name carries it for every screen reader; `aria-current` lets assistive tech and the grid's keyboard model (WeekGrid) find today's mark without parsing words. Nothing on screen marks today (K36).
- The NoteMark is `aria-hidden`; "has a note" in the name carries it.
- Enter and Space step the mark. Inside a WeekGrid the mark is one cell of a roving-tabindex grid (see WeekGrid); on its own it is an ordinary tab stop.
- Contrast, measured by the gate in both themes: `pen` reaches 4.5:1 on `canvas` and `panel` (it is also the text of a met total) and 3:1 on `tile`; `pen-missed` reaches 3:1 on `canvas`, `panel` and `tile`; the box is `control-border`, 3:1 on `canvas`, `panel` and `tile`. `pen-partial` is the exception, by the owner's choice (K18): a sunny yellow is 1.5–1.9:1 on the light grounds, and the gate holds it to 1.5:1 so it can't fade further; in dark it is above 7:1. The box drawn over it keeps a yellow mark findable. The kinds are told apart by their pens, the owner's call (K15): a fill of any kind differs from the empty box by shape, and the accessible name says "partly done" or "couldn't do it", but someone who can't tell green from red sees only "marked" in the squiggles. The tick and face sets give each kind its own shape. A stamped set's paper symbol on `pen-partial` is 1.8:1 in light, by the owner's choice (K23), held to 1.5:1 by the gate; on `pen` and `pen-missed` it reaches 3:1 in both themes.

## You provide

The row's name, the full date, whether it's today, the day's mark (`null`, or a kind with its drawing: `'great'`, `'partial-solid'`, `'missed-hatch'` and so on; `Mark` in `lib/storage.ts`), whether it has a note, the device's mark set (`set`, `MarkSet` in `lib/storage.ts`; the squiggles when not given), and the press handler, which sets the next mark in the row's cycle (`nextMark` with `cycleFor(item, set)` in `lib/tracker.ts`). The pens are fixed tokens. `DayMarkDrawing` draws the mark alone, without the button, for a picture of a mark (the Marks setting).
