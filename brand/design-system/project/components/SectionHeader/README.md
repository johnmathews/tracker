The heading over a WeekGrid: on the planner's screens the week centred above as the screen's title, then the section's name in the same serif a step smaller, and an optional line of hint.

## Use

- **The week is the title** (K86) on the planner's screens: "19–25 October", as the Header writes it, centred across the line at the top of each screen, in `title-1` (Source Serif 4, 600) at the title size (`--fs-title`, max(30px, 40u); 30n folded), in `ink`. 12u below it. It is how the week shows while the bar is out of sight, folded too. Edit plan leaves it out (K56, K81): its bar shows the week as the title. On paper it is left out; the page's `<h1>` prints there.
- **The section's name is a title too** (K87): "Exercises", "Food", in `title-1` (the serif, 600) at `--fs-section`, max(26px, 32u) (24n folded), a step under the week's 40u, in `ink`. Sentence case, no icon. On paper it is `title-1` at its own size.
- **Actions:** an optional slot centred on the title line. On screen the line is three columns, like the Header's (1fr, the actions, 1fr). Edit plan puts the section's daily target there (K56, K62, K63) while Daily goal is on (K85): a Stepper at max(44px, 40u), 1 to 8, its value reading "4 per day", with no words beside it; its label ("Exercises a day", "Foods a day") is for a screen reader. Folded, it follows the title and wraps under it.
- An optional hint beneath in `caption` `ink-secondary`, one line, plain instructions. Small numbers as words. The hint doesn't print. Neither section uses one: the user asked for both to go (journal 261024, 261025).
- 20u between the header and its grid. Each section is a PlannerScreen of its own, so nothing rules them apart.
- No figure (K31): the sections' weekly totals were removed by the owner's choice. The marks, and the days that turn green, say how the week is going. No subtitle counts, no badges, no eyebrow.

## States

| State | Look |
| --- | --- |
| On a PlannerScreen | the week centred as the title, the section's name under it at the start, a step smaller |
| In Edit plan | the section's name alone at 32u, the daily target centred on the line (none while Daily goal is off) |
| Folded | the week centred, the name under it (and its action under that) |
| Short | moved into the WeekGrid's corner; here only for a screen reader |

## Accessibility

- The section's name is a real heading, an `<h2>`, and labels its section: `<section aria-labelledby>`. The page's one `<h1>` is the week date ("19–25 October"), visually hidden on screen and set in `display` above the sections on paper; the Header (the app bar) holds no heading. The WeekGrid's `aria-label` repeats the section and week.
- The week shown as the title is `aria-hidden`: the page's `<h1>` already says it.
- `ink` on `canvas`, measured by the gate.

## You provide

The section title, the week label (left out in Edit plan), the hint text when there is one, and optionally actions for the title line (Edit plan's daily target).
