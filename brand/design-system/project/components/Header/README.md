The app bar: the wordmark on the left, the week navigation at the centre, and the actions on the right, as big and bold as the week below it. On the planner's screens it keeps out of sight: a long press opens Edit plan, where it is in view.

## Out of sight (K25, K80)

- **On the planner's screens** (PlannerScreen) the bar is hidden above the top edge. Asked for by a long press or the handle, it does not slide over the week: those open **Edit plan**, where the bar is sticky at the top and the page sits below it, so it never covers anything (K80).
- **A long press opens Edit plan** (K79, K80), anywhere on the screen: a press held 500ms with a mouse, pen or finger, moving no more than 10px. A second long press, in Edit plan, goes back to the week, as the Edit plan button does. Letting go sooner, moving further or scrolling does not count, and nor does a right click. The click that ends the hold does nothing, so a held day or button is never pressed, and a finger's or pen's hold opens no menu. A press in a field, a popover (an item's notes), a dialog or the bar is never a hold. The screens select no text outside fields, popovers and dialogs, so a hold never highlights a word. There is no mark while holding: the change of screen is the answer. (It replaces a 14px strip along the top edge.)
- **A finger opens it** with the handle too: a 40 × 5px pill in `control-border` at the top centre, in an 88 × 44px button named "Edit plan". A press opens Edit plan, and so does pulling the handle down. The handle shows wherever a coarse pointer is present (`any-pointer: coarse`), so an iPad with a trackpad has both.
- **The keyboard floats it** by focus, the one way it lies over the week: the bar slides over the screen in 160ms (none under `prefers-reduced-motion`) while focus is inside it, with its `line` rule and `shadow-overlay`. Tab from the top of the page reaches "Skip to today" and the bar's controls in view. Escape takes focus out and hides it. Moving focus never switches to Edit plan.
- **Edit plan keeps it in view** (K27), sticky at the top: the controls are the point there. The SettingsPage has no bar (K52).

## Use

- **Full width and as big as the week (K47).** The bar spans the window on the page's own margins (the PlannerScreen's 48u at the sides, 14u above and below), so the wordmark sits over the section's title and the last action over Sunday. Every size follows the screen through the PlannerScreen's `u`: about 108px tall at 1280×800 and 163px at 1920×1200. It can be that big because on the planner's screens it is out of sight until wanted.
- `canvas` background with a 1px `line` rule below; no blur.
- **Wordmark:** the BrandMark outline SVG, max(26px, 32u) tall, `fill: var(--ink)` so it follows the theme. Folded, the bar leaves it out (see Folded); there is no monogram (K44).
- **Layout:** three columns, `1fr auto 1fr`, so the week navigation sits at the centre of the bar whatever the two sides hold: the wordmark alone at the start of the first ("This week", when shown, at its end beside the week's arrows), the actions at the end of the third.
- **Week navigation:** a `nav` labelled "Week": "Previous week" (`chevron-left`) and "Next week" (`chevron-right`), each a max(28px, 32u) icon in a max(48px, 60u) quiet square, around the week label ("19–25 October") at max(20px, 26u), weight 600, `tabular-nums`, with a minimum width so the arrows never jump. The label is `aria-live="polite"`, so a change of week is announced.
- **Actions:** BarActions, a Lucide icon over its name. "This week" (`calendar`, shown only while another week is on screen) sits just left of the week's arrows, since it is a way back to this week; with it among the other actions the group grew too wide and pushed the week off centre (K50). At the right, 8u apart: "Edit plan" (`pencil`, a toggle that is filled while on; K48), "Settings" (`settings`, opens the SettingsPage), "Print…" (`printer`; left out below 640px wide) and, last, "Full screen" (K34, K49; `maximize`, or `minimize` and "Exit full screen" while full screen; left out where the browser has none, as on an iPhone). The markup follows that order, which is the tab order. The SettingsPage has no bar (K52).
- The bar holds no heading. The page's `<h1>` is the week date, visually hidden on screen (each SectionHeader shows the week beside its title; K54) and set in `display` on paper; the week label in the bar is plain text.
- Never `pen` in the bar. Nothing in it prints.

## States

- The arrows and BarActions take `tile` on hover and a 2px `focus` outline at 2px offset; Edit plan, while on, takes the `ink` fill (BarAction).
- **Folded** (held upright under 1000px wide, or any screen under 760px wide), on the planner: the wordmark is left out. The week takes the first row, centred, at 20n between 26n arrows in 48n squares; the actions share the second row equally ("This week" first when shown), each a 26n icon over its 16n name. The week moves up by CSS order, so the tab order ("This week", then the week) differs from the picture there. The week and the actions are what a phone's bar is for.
- Every target is at least 44px. Nothing scrolls sideways down to 320px.

## You provide

- The week label for the week on screen, and whether it is this week (to hide "This week").
- Handlers for previous, next and this week, and the way to the SettingsPage.
- The product name comes from the one place the code holds it; the bar never hard-codes it.
