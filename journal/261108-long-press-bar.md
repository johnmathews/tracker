# A long press opens Edit plan

On 2026-11-08 John asked for the navbar to come on a long press or long click anywhere, in place
of the invisible strip along the top edge (K25). That shipped locally as K79, with the bar sliding
over the week. Having tried it, he asked for more: "the navbar doesnt float on top of existing
content, but other content moves down. this way, the navbar never hides anything. also, when the
options view is enabled, lets also turn on edit mode." That is K80.

## What John decided

- **K79:** the week view only, and the handle at the top centre stays. A 500ms hold, cancelled
  by a move over 10px.
- **K80:** a long press opens Edit plan, and a second long press goes back to the week. The
  handle opens Edit plan too. Tab into the bar still floats it over the week, since moving focus
  shouldn't switch modes.
- Edit plan already had the bar sticky in the page (K27), with the page below it. Both asks
  were met by one existing screen, so there was no mockup.

## How it works

- `useBarReveal` listens on the document. A primary-button press outside a field, a popover, a
  dialog, the bar or its handle starts a 500ms timer. Letting go, a move over 10px or
  `pointercancel` (which a touch scroll sends) stops it. `AppNavbar` hands it two callbacks: a
  long press toggles `store.configMode`, and the handle sets it.
- A day cell marks itself on `click`, and a long press ends in one. So a capture-phase `click`
  listener on `window` swallows the next click after a hold. The guard lapses on the next press,
  any key, a window blur or a hidden page, or 300ms after `pointerup`. A touch hold may end with
  no click at all, and the guard must not wait for a later one.
- A finger's or pen's hold has its `contextmenu` prevented. `html.planner-screens` turns off
  text selection and the iOS callout, except in fields, popovers and dialogs.
- The floating state (`shown`, its hide timer, hide-on-leave and hide-on-press-elsewhere) is
  gone. Only `focus-within` floats the bar now.

## Review

A fresh reviewer read K79 and found no confident defect. Four of its low-confidence points were
fixed: a press lost to another window, a key's click, a pen's context menu on Windows, and copying
note text in the popover. A fifth, the bar hiding and coming back on a long press while shown, went
away with K80.

## Tests

- `PlannerScreen.spec.ts` covers the toggle both ways, by mouse and finger, and the presses that
  don't count. It checks that a held cell or button is never pressed, the guard's lapse, the
  context menu, blur and keys, the places a press is never a hold, the handle, and Escape in the
  floating bar. Each new test failed before its code.
- `e2e/screens.spec.ts` holds an unmarked day in Chromium. Edit plan opens with the bar sticky
  and the week below it. A second hold goes back, the day is unmarked, and a tap marks it. Under
  K80 this test passes even with the click guard off: opening Edit plan moves the page, so the
  release lands on another element. The guard is checked by the unit tests.
- `callUpBar` in `e2e/support.ts` opens Edit plan with a long press. The axe check of the floating
  bar brings it in with Tab.
- The PlannerScreen card's preview docks the bar above the page on a long press or the handle,
  and a second hold undocks it.
