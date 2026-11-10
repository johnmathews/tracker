# A slow drag turns after a fifth (K103)

John, once K100–K102 were live: "if I scroll slowly without momentum I find I have to “push” or
“pull” quite a long way before the next page will rotate into view".

A mandatory snap rests at the point nearest the page when the finger lifts, so a slow drag had to
go past half the window. No CSS property sets that threshold.

- `useScreenSprint` now watches a drag on a touch screen. While the finger is slow (under 0.3px a
  ms over the last 100ms, or still) and the page has moved a fifth of the window, snapping is off.
  On lifting, `scrollTo({ behavior: 'smooth' })` takes the page to the next snap point the way it
  went (`turnTarget`), and snapping comes back on once it rests there.
- Snapping goes off before the finger lifts, so iOS never starts a snap-back the script would then
  have to fight; that fight is what made K98's first try jitter. A faster finger turns it back on,
  so a fling is unchanged.
- Checked in WebKit (iPhone 15, 393×793) with a simulated slow drag: down to Cardio, up from
  Exercises onto the copy of Food and then the real Food, and a 90px drag springing back. 1339
  unit tests green. John on his iPhone over Tailscale: "It works well".
