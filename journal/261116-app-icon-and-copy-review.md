# App icon, copy review and Filled in

> Purpose
>
> Records the app icon (K139), the item page's plan line (K138), the copy review (K140) and the
> Filled in mark set (K141).

## 1. What changed

- **The app icon (K139).** John picked option A on the mockup `261115-app-icon`, then switched
  to C before it shipped: a stamped tick, the box and tick in paper on `pen` green.
  `scripts/app_icon.py` draws the
  favicon (SVG with a dark variant, and `.ico`), the iPhone icon, the manifest's icons and the
  manifest from the DayMark's paths and the tokens. CI's "App icon is current" step runs it with
  `--check`. The PNGs need rsvg-convert and ImageMagick locally, so CI checks only the SVGs and
  the manifest.
- **The plan line (K138).** "Changes this week’s plan, and the weeks after it that have no plan
  of their own." is gone from an item's page, and its "Adds it to…" twin from the new item page.
  The line stays for an item missing from the week, where it says whose plan is showing.
- **The copy review (K140).** A reviewer read every screen string against voice.md and found 23
  things. John applied all of them. Several reverse wording from K66, K127 and K129.
- **Filled in (K141).** The solid fill left Squiggles for a set of its own, after Squiggles in
  Settings › Marks. Squiggles now steps through the zigzag and the hatch, and draws a day saved
  with the solid fill as the zigzag; Filled in draws every day solid. `nextMark` now steps a
  drawing the cycle doesn't hold on from the first mark of its kind, so a squiggle pressed in
  Filled in goes on to the next solid kind rather than to empty.

## 2. Notes

- The icon is the one place `pen` stands outside a day's mark. John accepted that when picking.
- The home-screen icon keeps the light colours. A web clip has no dark variant on iOS.
- The manifest has no `display`, so the app doesn't install as a standalone window. That would
  be a behaviour change of its own.

## 3. Shipped, then the wrap-up (2026-11-17)

- Confirmed: CI run 43835050725 on 5606b2d passed `api`, `check` and `e2e`. Docker run
  43835861288 on fbf968b published `tracker` and `tracker-api`. John checked the live site:
  "it works".
- A docs audit against the shipped code found gaps, and the wrap-up fixed them:
  - The new CI step "App icon is current" was missing from `docs/deployment.md` and
    `docs/development.md`.
  - The development guide didn't cover `scripts/app_icon.py`: when to rerun it, and that the PNGs
    need rsvg-convert and ImageMagick.
  - The design system's README and `foundations.md` didn't list the app icon as a use of `pen`,
    which `docs/brand.md` already did.
  - `docs/architecture.md` described `markLook` from before Filled in.
  - The styleguide's ConfirmDialog still showed the old Remove copy.
- Filed #75: a touch fling e2e test failed once and passed on retry on 2026-11-16. Today's
  local run passed 132 of 132.

## What is deliberately not done

- No index of the mockups, and no link to this entry from the README. The README links the
  `journal/` folder, and `docs/decisions.md` links the mockup.
- The manifest gets no `display: standalone` (see §2).
