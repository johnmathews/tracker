The product's name as a mark: the "Tracker" wordmark in Source Serif 4 600. There is no drawn logo and no monogram (K44); the app icon is a stamped tick (K139, `assets/AppIcon`).

## Use

- **Wordmark:** the outlined path from `assets/Wordmark/tracker-wordmark-ink.svg`, inlined with `fill: var(--ink)` so it follows the theme. 32px tall on the sign-in card, 20px in the Header, and anywhere the serif font may not load. Never below 16px tall. The cover does not use it: there the name is set as live serif text (Source Serif 4 600, 88px) with a tagline beneath, as a title rather than a mark.
- Where an inline SVG is impossible (an `<img>`, a document), use the asset files: `tracker-wordmark-ink.svg` (`ink` light value) on light grounds, `tracker-wordmark-light.svg` (`ink` dark value) on dark ones.
- **No monogram** (K44): "Tracker" is short enough for the phone's Settings bar, where "FP" stood, and a monogram served no other purpose. The favicon and the app icon are a stamped tick, paper on green (K139, `assets/AppIcon`), not a letter.
- Clear space: at least the height of the capital "T" on every side. Nothing touches it.
- Only `ink` (or `on-ink` on an `ink` fill). Never `pen`, a gradient, a shadow, an outline or a tagline beside the wordmark (the cover's tagline sits under the live-text name, not the mark). Never stretch, re-letter or redraw it.
- "Tracker" is the name since 2026-10-26 (K44), after "Fitness Planner". The name lives in one place in the code, and the wordmark asset is regenerated from type by `scripts/wordmark.py` when it changes.

## States

- None: the mark is not interactive. When it links home, the link carries the focus ring (TextLink rules, without the underline).

## You provide

- `size` (`md`, `lg`). The component sets `role="img"` and the accessible name "Tracker" from the app's one name string.
