# A trackpad swipe moves one screen again (K108)

John: "its difficult to only scroll 1 tracker using the macbook trackpad. the momentum carries the
scroll across 2 trackers not just 1 even with a little scroll movement."

The one-push rule (K94) swallows a swipe's momentum once it has moved a screen. Two traces of
John's trackpad in Chrome, taken with a temporary dev-only recorder, showed why it didn't work:

- The first wheel event of the swipe was cancellable and the screens let it through. Every later
  one, the momentum included, came `cancelable: false`. Chrome cancels a scroll sequence only by its
  first event. If that one goes through, the rest are sent without blocking.
- So `preventDefault()` on the momentum did nothing. The page drifted about 34px past the screen a
  sprint had landed on, past the 4% step, and the scroll handler sprinted again.
- Reduced motion is on in John's Chrome. There the sprint is a jump that takes in none of the
  momentum, so every swipe did it. With the 260ms eased sprint, the sprint's own frames hide
  most of it, which may be why it wasn't seen before.

The fix: the screens cancel every wheel step they let through and scroll it with
`window.scrollBy`, so Chrome keeps every later step cancellable. The browser keeps a pinch, a step
more sideways than up or down (a Mac's Back and Forward), a step over an inner area that can scroll
that way (`scrollsInside`), and a step that already arrives uncancellable.

## What was observed

- Confirmed: trace 2 showed the first step `can=True` and every later one `can=False`, with the
  page going 855 → 889 after a landing and a second sprint to 1710 with no new push.
- Confirmed: trace 3, with the fix, showed all 492 wheel steps cancellable, 0px of drift after any
  landing, and no second sprint without a new gesture or push. John: "that works well!"
- Confirmed: 1,391 web unit tests passed, with branch coverage at 98.09%. The two tests for the
  new behaviour failed on the old code. The two pins (momentum swallowed; pinch, sideways and
  uncancellable left alone) failed when their behaviour was broken by hand.
- Not observed: Safari, Firefox, a mouse wheel on a real device, or reduced motion off on John's
  Mac. The e2e suite's Chromium mouse-wheel tests passed.

## What is deliberately not done

- No change to `MomentumWatch` (K95, K96). The traces show it never misfired.
- No change on touch screens, where the browser snaps (K98).
- A mouse wheel's notch inside a screen taller than the window now moves the page in one jump
  (`scrollBy`, instant), where Chrome animated it. Across a line between screens the sprint
  still animates. Left as it is unless it shows.
