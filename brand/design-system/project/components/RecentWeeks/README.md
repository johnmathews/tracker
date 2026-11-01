An item's last eight weeks, newest first, one line a week: when, its seven marks, and the count against that week's goal.

## Use

- **Where:** the Recent weeks row of the ItemPage, the last row, to the right of its heading (K65). It is part of the record layer: quiet, small marks, `ink-secondary` around them. Nothing else uses it.
- **One line a week**, newest first, up to eight weeks, ending with the week the page was opened from. A newer item shows only the weeks since it first appeared in a plan. Lines are separated by 1px `line` hairlines, with one above the first and one below the last.
- **When:** "This week" (weight 600) for the current week, otherwise the week's Monday as "26 Oct", in `body` `ink`. The column is as wide as its longest label, so "This week" never wraps.
- **The seven marks,** Monday to Sunday: each day's DayMark drawing (DayMark, `DayMarkDrawing`) in the device's mark set (K20), max(20px, 24u) square, 6u apart. They are pictures, not buttons: nothing on the line can be pressed. An empty day is the empty `control-border` box. The preview shows the Stamped ticks set. The squiggles and the other sets draw at the same size.
- **The count,** in `body`, as figures because it is data: the days marked that week against that week's goal, "2 of 3", in `ink-secondary`. Every kind of mark counts, missed included, as in the week's totals (K9, K65). In John's words: "count every mark because red is still a "done" mark. its just says "this was very difficult"".
  - **A week that met its goal** draws its count in `pen` at weight 600, underlined like a met day's name (K60): a plain text underline max(2px, 3u) thick, 0.22em under the letters. `pen` is never used for anything else here.
  - **A week whose plan didn't hold the item** reads "Not planned" in `ink-secondary`, with seven empty boxes. On a phone the words may wrap onto a second line. A count ("3 of 3", "2 days") never breaks.
  - **A week whose goal was 0** shows only the days marked, "2 days", and is never met.
- **The line above the list,** in `body` `ink-secondary`: "The goal was met in three of the last eight weeks.", with "three of the last eight weeks" in `ink`. Small numbers are words, as in any sentence (voice.md). The line counts the weeks shown, so a week not planned counts as not met. It is left out when no week met its goal, and when only one week shows: the counts already say it.
- No chart, no totals beyond that line, no run of weeks met, no comparison between weeks.
- **Sizes:** text at the ItemPage's body size, max(18px, 19u), with 8u above and below each line and 14u between the three columns. **Folded,** text 18n, marks min(24n, 5.4vw) with 3px between them, 10px between the columns. The marks shrink on a narrow phone so a week stays on one line down to 320px wide.
- **Print:** prints as shown, in the light theme's colours on white paper (K16), with the ItemPage.

## States

| Week | Count |
| --- | --- |
| Goal met | "3 of 3" in `pen`, 600, underlined, and ", goal met" for a screen reader |
| Goal not met | "1 of 3" in `ink-secondary` |
| Not in that week's plan | "Not planned" in `ink-secondary`, seven empty boxes |
| Goal of 0 | "2 days" in `ink-secondary` |
| This week | "This week" in 600, `aria-current="date"` on its line |

## Accessibility

- An `<ol>` labelled by the section's heading ("Recent weeks"). Each week is an `<li>`.
- The drawings are `aria-hidden`. Visually hidden text carries what they show, so each line reads as one sentence: "Week of 19 October. Marked Monday, Wednesday (partly done) and Friday. 3 of 3, goal met." This week reads "This week" in place of the date, and a week with nothing marked reads "Nothing marked".
- The short date shows on screen ("19 Oct") and is `aria-hidden`. The hidden text writes the month in full.
- Contrast, measured by the gate in both themes: `pen` on `canvas` reaches 4.5:1 (4.9:1 light, 8.8:1 dark, measured on the mockup), and the box is `control-border`, 3:1 on `canvas`.

## You provide

Up to eight weeks, newest first, each with its Monday, whether it is the current week, its seven marks (`null` or a `Mark`, as in `lib/storage.ts`), and its goal (a number, or nothing when the week's plan didn't hold the item). Also the device's mark set and the id of the heading that labels the list.
