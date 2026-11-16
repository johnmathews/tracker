The heading over a WeekGrid: the tracker's name in the serif a step under the week's, in Edit plan with its pen, and an optional line of hint. The week itself is the page's title, fixed above the planner's screens (PlannerScreen).

## Use

- **The week on paper only** (K88, K97). On screen the week is the page's title (K86): on the planner's screens a band fixed at the top that the screens move under (PlannerScreen), and in Edit plan the bar's title (K81), so the header doesn't repeat it. On paper each section prints on a page of its own, so the header sets the week over it, in `display` in `ink`, `aria-hidden` since the page's `<h1>` says it.
- **The tracker's name is a title too** (K87, K123): "Strength", "Food", the name the person gave it, in `title-1` (the serif, 600) at `--fs-section`, max(26px, 32u) (24n folded), a step under the week's 40u, in `ink`. Sentence case, no icon. On paper it is `title-1` at its own size.
- **The pen** (K124): in Edit plan an optional slot follows the title, 14u after it, holding an IconButton with `pencil` in `ink-secondary`, at Edit plan's `--edit-ib`, named "Rename Strength", as an item's name has (K121). Pressed, the title becomes a field in its own type (`title-1` at `--fs-section`, the `panel` fill, `control-border`, `radius-sm`, up to 420u wide) with a secondary Button "Done" (`check`) beside it, at the page's control size. Enter or Done saves; Escape puts the old name back; an empty name says "Enter a name." under the field. While the field shows, the `<h2>` stays for a screen reader only (`titleHidden`). Outside Edit plan the title has no pen.
- **Actions:** an optional slot centred on the title line. On screen the line is three columns, like the Header's (1fr, the actions, 1fr). Edit plan puts the section's daily target there (K56, K62, K63) while Daily goal is on (K85): a Stepper at max(44px, 40u), 1 to 8, its value reading "4 per day", with no words beside it; its label ("Exercises a day", "Foods a day") is for a screen reader. Folded, it follows the title and wraps under it.
- **The end of the line:** a second optional slot, in the third column, at its end. Edit plan puts the tracker's Add button there (K113), its words from the tracker's kind: "Add exercise" (strength and mobility, K140), "Add cardio", "Add food". It is the outline Button at the page's control size, at the end of the grid's width, so Add is in view whenever the tracker is. "Delete tracker" follows it, 12u on (K122): the same secondary Button with `trash-2`. It asks first in the ConfirmDialog, "Delete Strength?" "It comes off this week and the weeks after. Earlier weeks keep it." (K140) (K129) · Cancel · Delete. (K113 set it over the Remove column, which K120 dropped.) Folded, the two keep to the end of the title's line, wrapping under the title when the line is too narrow.
- An optional hint beneath in `caption` `ink-secondary`, one line, plain instructions. Small numbers as words. The hint doesn't print. Neither section uses one: the user asked for both to go (journal 261024, 261025).
- 20u between the header and its grid. Each section is a PlannerScreen of its own, so nothing rules them apart.
- No figure (K31): the sections' weekly totals were removed by the owner's choice. The marks, and the days that turn green, say how the week is going. No subtitle counts, no badges, no eyebrow.

## States

| State | Look |
| --- | --- |
| On a PlannerScreen | the section's name at the start, under the fixed week |
| In Edit plan | the tracker's name at 32u with its pen, the daily target centred on the line (none while Daily goal is off, none for cardio), and Add and Delete tracker at its end (K113, K122) |
| Renaming | the field in the title's type and Done where the name and pen were; Add and Delete tracker stay (K124) |
| Folded | the name (and its action under it) |
| Short | moved into the WeekGrid's corner; here only for a screen reader |

## Accessibility

- The section's name is a real heading, an `<h2>`, and labels its section: `<section aria-labelledby>`. The page's one `<h1>` is the week date ("19–25 October"), visually hidden on screen and set in `display` above the sections on paper; the Header (the app bar) holds no heading. The WeekGrid's `aria-label` repeats the section and week.
- `ink` on `canvas`, measured by the gate.

## You provide

The tracker's name, the hint text when there is one, and optionally the title slot (Edit plan's pen or rename field, with `titleHidden` while the field shows), actions for the title line (Edit plan's daily target) and for its end (Edit plan's Add and Delete tracker).
