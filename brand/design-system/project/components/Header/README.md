The app bar: the week first, set as the page's title, and the actions at the end, as big and bold as the week below it. On the planner's screens it keeps out of sight: a long press opens Edit plan, where it is in view.

## Out of sight (K25, K80)

- **On the planner's screens** (PlannerScreen) the bar is hidden above the top edge. Asked for by a long press or the handle, it does not slide over the week: those open **Edit plan**, where the bar is sticky at the top and the page sits below it, so it never covers anything (K80).
- **A long press opens Edit plan** (K79, K80), anywhere on the screen: a press held 500ms with a mouse, pen or finger, moving no more than 10px. A second long press, in Edit plan, goes back to the week, as E and Esc do (K91). Letting go sooner, moving further or scrolling does not count, and nor does a right click. The click that ends the hold does nothing, so a held day or button is never pressed, and a finger's or pen's hold opens no menu. A press in a field, a popover (an item's notes), a dialog or the bar is never a hold. The screens select no text outside fields, popovers and dialogs, so a hold never highlights a word. There is no mark while holding: the change of screen is the answer. (It replaces a 14px strip along the top edge.)
- **A finger opens it** with the handle too: a 40 × 5px pill in `control-border` at the top centre, in an 88 × 44px button named "Edit plan". A press opens Edit plan, and so does pulling the handle down. The handle shows wherever a coarse pointer is present (`any-pointer: coarse`), so an iPad with a trackpad has both.
- **The keyboard floats it** by focus, the one way it lies over the week: the bar slides over the screen in 160ms (none under `prefers-reduced-motion`) while focus is inside it, with its `line` rule and `shadow-overlay`. Tab from the top of the page reaches "Skip to today", then "Edit plan" ("Done" in Edit plan; K82, K91), then the bar's controls, in view. Escape takes focus out and hides it. Moving focus never switches to Edit plan; pressing "Edit plan" does.
- **Edit plan keeps it in view** (K27), sticky at the top, with Edit plan's screens under it (K99). Its height is published as `--bar-height` on the page, so each screen is the window less the bar. The bar showing and Edit plan are one thing (K80), so there is no Edit plan button, and no Done either (K91): a long press, E or Esc go back to the week. The SettingsPage has no bar (K52).
- **Keys** on the week (K91): E goes into Edit plan and out again; Esc leaves full screen, or else Edit plan; F is Full screen, P Print and S Settings, each as its button does. A key does nothing while typing in a field, with Ctrl, ⌘ or Alt held, or while a dialog or popover is open. The buttons name their key in `aria-keyshortcuts`. On every page, signed in, H or B goes back and L goes forward, as the browser's own buttons do, under the same rules (K105).

## Use

- **Full width and as big as the week (K47).** The bar spans the window on the page's own margins (the PlannerScreen's 48u at the sides, 14u above and below), so the week sits over the section's title and the last action over Sunday. Every size follows the screen through the PlannerScreen's `u`: about 108px tall at 1280×800 and 163px at 1920×1200. It can be that big because on the planner's screens it is out of sight until wanted.
- `canvas` background with a 1px `line` rule below; no blur.
- **No wordmark** (K81): the week is the bar's title. The product's name is in the page title and on the sign-in card.
- **Layout** (K81): one row, `justify-between`: the week navigation at the start, the actions at the end.
- **Week navigation:** a `nav` labelled "Week": "Previous week" (`chevron-left`) and "Next week" (`chevron-right`), each a max(28px, 32u) icon in a max(48px, 60u) quiet square, around the week label ("19–25 October") set as the page's title: `title-1`, the serif at 600, at the section titles' size (`--bar-week` = `--fs-title`, max(30px, 40u)), `tabular-nums`, with a minimum width so the arrows never jump. The label is `aria-live="polite"`, so a change of week is announced.
- **Actions:** BarActions, a Lucide icon over its name, 8u apart at the end: "This week" (`calendar`, shown only while another week is on screen; K81), "Ask" (`message-circle`, only while the API answers questions), "Settings" (`settings`, opens the SettingsPage), "Print…" (`printer`; left out below 640px wide), "Full screen" (K34, K49; `maximize`, or `minimize` and "Exit full screen" while full screen; left out where the browser has none, as on an iPhone). The markup follows that order, which is the tab order. The SettingsPage has no bar (K52).
- **"Edit plan" for the keyboard** (K82, K91): the second Tab stop, after "Skip to today", out of sight until it has focus, then shown over the start of the bar like "Skip to today" (a `panel` pill with the focus ring). Pressing it opens Edit plan; in Edit plan it reads "Done" and goes back. Its key is E. A mouse or a finger never sees it: they have the long press and the handle.
- The bar holds no heading. The page's `<h1>` is the week date, on the planner's screens a band fixed at the top centre that the screens move under (K86, K88), visually hidden in Edit plan and set in `display` on paper; the week label in the bar is plain text.
- Never `pen` in the bar. Nothing in it prints.

## States

- The arrows and BarActions take `tile` on hover and a 2px `focus` outline at 2px offset.
- **Folded** (held upright under 1000px wide, or any screen under 760px wide), on the planner: the week takes the first row, centred, at 26n between 26n arrows in 48n squares; the actions share the second row equally ("This week" first when shown), each a 26n icon over its 16n name. The week and the actions are what a phone's bar is for.
- Every target is at least 44px. Nothing scrolls sideways down to 320px.

## You provide

- The week label for the week on screen, and whether it is this week (to hide "This week").
- Handlers for previous, next and this week, and the way to the SettingsPage.
