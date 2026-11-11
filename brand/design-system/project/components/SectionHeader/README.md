The heading over a WeekGrid: the section's name in the serif a step under the week's, and an optional line of hint. The week itself is the page's title, fixed above the planner's screens (PlannerScreen).

## Use

- **The week on paper only** (K88, K97). On screen the week is the page's title (K86): on the planner's screens a band fixed at the top that the screens move under (PlannerScreen), and in Edit plan the bar's title (K81), so the header doesn't repeat it. On paper each section prints on a page of its own, so the header sets the week over it, in `display` in `ink`, `aria-hidden` since the page's `<h1>` says it.
- **The section's name is a title too** (K87): "Exercises", "Food", in `title-1` (the serif, 600) at `--fs-section`, max(26px, 32u) (24n folded), a step under the week's 40u, in `ink`. Sentence case, no icon. On paper it is `title-1` at its own size.
- **Actions:** an optional slot centred on the title line. On screen the line is three columns, like the Header's (1fr, the actions, 1fr). Edit plan puts the section's daily target there (K56, K62, K63) while Daily goal is on (K85): a Stepper at max(44px, 40u), 1 to 8, its value reading "4 per day", with no words beside it; its label ("Exercises a day", "Foods a day") is for a screen reader. Folded, it follows the title and wraps under it.
- **The end of the line:** a second optional slot, in the third column, at its end. Edit plan puts the section's Add button there (K113): "Add exercise", "Add cardio", "Add food", the outline Button at the page's control size, over the grid's Remove column, so adding and removing run down one edge and Add is in view whenever the section is. Folded, it keeps to the end of the title's line.
- An optional hint beneath in `caption` `ink-secondary`, one line, plain instructions. Small numbers as words. The hint doesn't print. Neither section uses one: the user asked for both to go (journal 261024, 261025).
- 20u between the header and its grid. Each section is a PlannerScreen of its own, so nothing rules them apart.
- No figure (K31): the sections' weekly totals were removed by the owner's choice. The marks, and the days that turn green, say how the week is going. No subtitle counts, no badges, no eyebrow.

## States

| State | Look |
| --- | --- |
| On a PlannerScreen | the section's name at the start, under the fixed week |
| In Edit plan | the section's name at 32u, the daily target centred on the line (none while Daily goal is off), and Add at its end (K113) |
| Folded | the name (and its action under it) |
| Short | moved into the WeekGrid's corner; here only for a screen reader |

## Accessibility

- The section's name is a real heading, an `<h2>`, and labels its section: `<section aria-labelledby>`. The page's one `<h1>` is the week date ("19–25 October"), visually hidden on screen and set in `display` above the sections on paper; the Header (the app bar) holds no heading. The WeekGrid's `aria-label` repeats the section and week.
- `ink` on `canvas`, measured by the gate.

## You provide

The section title, the hint text when there is one, and optionally actions for the title line (Edit plan's daily target) and for its end (Edit plan's Add).
