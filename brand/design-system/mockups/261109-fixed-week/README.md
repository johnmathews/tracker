# The week fixed at the top

**Question:** on the planner's screens the date stays at the top centre while Exercises and Food
scroll under it. Does a hairline show under the date while a screen passes beneath? The date's look
(K86), the section titles (K87) and Edit plan's bar stay as they are.

**Status:** decided (2026-11-09); round 2 shows a third tracker

**Link:** https://claude.ai/artifact/GwmqMjwkeVuBkxJdRHZ2ip (private)

`fixed.js` and `fixed.css` draw a frame you can scroll, with the date as a sticky band and the two
screens each the frame's height less the band's. Scroll snapping stands in for the app's sprint
(K38). New values are `--candidate-*`.

## Options

- **F1. A hairline once a screen moves under the date.** 1px in `line`, absent at the top of
  Exercises. (Recommended: the screen sliding under gets a clear edge.)
- **F2. No line.** The date on the bare canvas.

## Decision

John picked **F1** on 2026-11-09, the recommended option (K88). While trying it he found the
wheel couldn't turn straight back after a sprint, fixed as K89. He then asked: "if i had three
trackers - lets mock an extra one up, for cardio (cycling and running), lets see how that works.
can i scroll down twice". Round 2 adds a frame with Exercises, Cardio and Food under the fixed
date, with F1. It shows the layout only; a third tracker is not decided or built.

## Rounds

- **1, 2026-11-09:** F1 or F2.
- **2, 2026-11-09:** three trackers (Cardio: cycling and running), to try scrolling down twice.
