The planner's layout: the week fixed at the top, Exercises, Cardio and Food each filling the screen under it, the page sprinting from one to the next, and the Header out of sight until it is wanted.

## Use

- **The week, fixed at the top** (K88). The page's `<h1>`, "19–25 October", is a band at the top centre that stays put while the screens move under it: `title-1` (the serif, 600) at `--fs-title` (max(30px, 40u); 30n folded), in `ink`, on `canvas`, 28u above it and 12u below (34n and 8px folded). Its height is `--week-band`. At the top of Exercises it has no edge; once a screen is under it, a 1px hairline in `line` shows at its foot. The touch handle (Header) lies over its middle.
- **One section per screen** (K24). Exercises is the first screen, Cardio the second and Food the third (K90). Each is at least the window's height less the band (`100dvh - --week-band`). The page's `scroll-padding-top` is the band's height, so focus never lands under it.
- **Sprinting, not snapping** (K38). A screen with more rows than fit scrolls as usual. The page never comes to rest showing part of two screens: once the line between them is a step (4% of the window, at least 16px) inside it, the page sprints on in the direction it was going, down so the next screen's top meets the band's foot, or up so the earlier screen's end meets the bottom of the window (K45, K88). A wheel, or a fling's momentum after the finger lifts, sprints while it is still moving; a finger on the screen holds the page; a scrollbar drag or the keyboard once the scroll stops (120ms still). The sprint takes 260ms, eased out, at once when motion is reduced, and a swipe moves one screen at most (K94): the rest of that wheel gesture, its momentum however long it runs, is ignored. A gesture is a run of wheel events less than 150ms apart, so the next swipe or notch, after the wheel has been still that long, moves the next screen at once, and scrolling on keeps going round. A wheel the other way stops the sprint where it is and goes straight back (K89). **The screens wrap round** (K92): a new wheel gesture or a swipe that starts at the page's foot and goes a step on brings the first screen up from below, and one at the top going up brings the last down from above, in the same 260ms sprint. A copy of the screen, inert and hidden from a screen reader, stands in beyond the end while it moves, then the page jumps to the real one, which looks the same. A fling that reaches the foot of a tall screen stops there. A resize or a rotation that leaves the page across the line settles on the screen that fills more of the window (K40). This is script, not CSS snapping: with `scroll-snap-type: y mandatory`, a mouse wheel at the end of a tall screen snapped back instead of crossing to the next.
- **Inside a screen:** a column holding the SectionHeader, then its WeekGrid, which takes the rest of the height (WeekGrid, Filling the screen). When the week is shorter than the screen it sits in the middle. Padding follows the screen's scale `u` (WeekGrid): 12u under the band, 48u at the sides, 20u at the foot. Folded (held upright), 10px under the band and 16n at the sides.
- **The arrows between the screens** (K42, K90): a quiet IconButton with a 24px Lucide `chevron-down`, no words, centred at the foot of each screen but the last, in `ink-secondary`; and one with `chevron-up` on each screen but the first, centred on its title's line just under the band. A down arrow sprints to the next screen's top and an up arrow to the one before (the sprint above). So Exercises has one down, Cardio one up and one down, and Food one up. A short screen leaves them out.
- **The bar** is the Header, out of sight (Header, Out of sight): a long press anywhere, the handle or E opens Edit plan, where the bar is sticky above the page (K80, K91); focus floats it over the screen for the keyboard.
- **Messages** (Banner: sync, confirm your email, import) sit at the top of the Exercises screen, under the band and above its SectionHeader, and push the section down while they show.
- **Every screen size gets this layout.** A desktop, an iPad on its side and a phone on its side get the wide grid; a screen held upright under 1000px wide, or any screen under 760px wide, gets the folded one (K26). There is no separate phone view.
- **Not in Edit plan or Settings** (K27): there the page scrolls freely, nothing sprints and the sections are as tall as their content. Edit plan keeps the bar in view; Settings has none (K52). The week's `<h1>` is hidden on screen there, since Edit plan's bar shows the week (K81), and shows in `display` only on paper.
- **Print** is unchanged: no sprinting, no bar, the WeekGrid as a table on paper.

## States

| State | Look |
| --- | --- |
| At rest | the week fixed at the top (K86, K88), then the screen: the section's heading, the week's grid, and the arrows to the screens before and after it |
| Moving, or on Cardio or Food | a screen under the band, with the hairline at the band's foot |
| Bar called up | the Header over the top of the screen, with `shadow-overlay` |
| Short (540px tall or less) | no band (the week is for a screen reader only); the title in the grid's corner; no chips, no arrows |
| Folded (upright under 1000px wide, or under 760px wide) | the WeekGrid folded; the band at 30n |

## Accessibility

- Each screen is a `<section aria-labelledby>` on its SectionHeader's `<h2>`. The band is the week's `<h1>`, before them all, so the heading outline is unchanged; where the band is hidden it stays for a screen reader.
- The sprint never traps the keyboard: focus moving into the Cardio or Food grid scrolls it into view, and a stop across a line sprints on to the next screen.
- Each arrow is a real `<button>` named for where it goes: "Go to Cardio", "Back to Exercises", "Go to Food" and "Back to Cardio".
- Nothing depends on hover: a long press, the handle and focus reach the bar with a mouse, a finger or the keyboard. Only focus lays it over the week.

## You provide

- The sections, in order (Exercises, Cardio, Food), and whether Edit plan or another page is showing (which turns the layout off).
- The messages to show, if any.
