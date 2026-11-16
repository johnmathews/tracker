The app icon and favicon: a stamped tick, the whole icon in `pen` green with the DayMark's hand-drawn box and the Ticks set's great tick in paper (`on-ink`), as in Stamped ticks (K139).

- `tracker-icon.svg`: the home-screen icon, square; the phone rounds its corners. The box is 58% of the icon. It keeps the light colours, because a home screen shows one picture on every wallpaper.
- `tracker-icon-maskable.svg`: the same, smaller (the box 43%), so Android's mask never cuts the box or the tick.
- `tracker-favicon.svg`: the browser tab's icon, on a 32-unit tile with 7-unit corners, heavier strokes so it holds at 16px. It switches to the dark colours under `prefers-color-scheme: dark`.

`scripts/app_icon.py` writes these, the app's `public/` copies (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and `manifest.webmanifest`, from the DayMark's paths and the tokens. Never edit them by hand. It is the one place `pen` stands outside a day's mark, because it still stamps a day done well.
