The planner's layout: Exercises and Food each fill the screen, the page sprints from one to the other, and the Header keeps out of sight until it is wanted.

## Use

- **One section per screen** (K24). Exercises is the first screen and Food the next. Each is at least the screen's height (`100dvh`). The page's `scroll-padding-top` is 0 here, since no bar covers the top.
- **Sprinting, not snapping** (K38). A screen with more rows than fit scrolls as usual. The page never comes to rest showing part of both screens: once the line between them is a step (4% of the window, at least 16px) inside it, the page sprints on in the direction it was going, down to the next screen's top or up so the earlier screen's end meets the bottom of the window (K45). A wheel, or a fling's momentum after the finger lifts, sprints while it is still moving; a finger on the screen holds the page; a scrollbar drag or the keyboard once the scroll stops (120ms still). The sprint takes 260ms, eased out, at once when motion is reduced, and the wheel is ignored until it has been quiet for 180ms after it. A resize or a rotation that leaves the page across the line settles on the screen that fills more of the window (K40). This is script, not CSS snapping: with `scroll-snap-type: y mandatory`, a mouse wheel at the end of a tall screen snapped back instead of crossing to the next.
- **Inside a screen:** a column holding the SectionHeader, then its WeekGrid, which takes the rest of the height (WeekGrid, Filling the screen). When the week is shorter than the screen it sits in the middle. Padding follows the screen's scale `u` (WeekGrid): 28u at the top, 48u at the sides, 20u at the foot. Folded (held upright), 34n at the top for the handle and 16n at the sides.
- **The arrows between the screens** (K42): a quiet IconButton with a 24px Lucide `chevron-down`, no words, centred at the foot of the Exercises screen, in `ink-secondary`; and one with `chevron-up` on the Food screen, centred 48px from its top, below the bar's handle. Each sprints to the other screen's top (the sprint below). A short screen leaves them out.
- **The bar** is the Header, out of sight (Header, Out of sight): a long press anywhere or the handle opens Edit plan, where the bar is sticky above the page (K80); focus floats it over the screen for the keyboard.
- **Messages** (Banner: sync, confirm your email, import) sit at the top of the Exercises screen, above its SectionHeader, and push the week down while they show.
- **Every screen size gets this layout.** A desktop, an iPad on its side and a phone on its side get the wide grid; a screen held upright under 1000px wide, or any screen under 760px wide, gets the folded one (K26). There is no separate phone view.
- **Not in Edit plan or Settings** (K27): there the page scrolls freely, nothing sprints and the sections are as tall as their content. Edit plan keeps the bar in view; Settings has none (K52). The week's `<h1>` is hidden on screen there too, each section titled with the week beside it (K54), and shows in `display` only on paper.
- **Print** is unchanged: no sprinting, no bar, the WeekGrid as a table on paper.

## States

| State | Look |
| --- | --- |
| At rest | the screen alone: the title line, the week, and the arrow to the other screen |
| Bar called up | the Header over the top of the screen, with `shadow-overlay` |
| Short (540px tall or less) | the title in the grid's corner; no chips, no arrows |
| Folded (upright under 1000px wide, or under 760px wide) | the WeekGrid folded; the week's name left off the title line |

## Accessibility

- Each screen is a `<section aria-labelledby>` on its SectionHeader's `<h2>`. The week's `<h1>` stays in the page, visually hidden, so the heading outline is unchanged.
- The sprint never traps the keyboard: focus moving into the Food grid scrolls it into view, and a stop across the line sprints on to Food's screen.
- Each arrow is a real `<button>` named for where it goes: "Go to Food" and "Back to Exercises".
- Nothing depends on hover: a long press, the handle and focus reach the bar with a mouse, a finger or the keyboard. Only focus lays it over the week.

## You provide

- The two sections, in order, and whether Edit plan or another page is showing (which turns the layout off).
- The messages to show, if any.
