#!/usr/bin/env python3
"""Draw Tracker's app icon and favicon: a stamped tick, the box and tick in paper on green (K139).

The paths are the DayMark card's own (src/components/ui/day-mark/index.ts) and the colours the
tokens' (brand/design-system/project/tokens.json), so the icon is the mark on the planner. The
name in the manifest is APP_NAME (src/lib/app.ts).

  python3 scripts/app_icon.py           # write the SVGs and the manifest, then the PNGs and .ico
  python3 scripts/app_icon.py --check   # exit 1 when a committed SVG or the manifest is stale

Writing the PNGs and favicon.ico needs rsvg-convert and ImageMagick (`brew install librsvg
imagemagick`); --check needs neither, so CI runs it.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKS = ROOT / "src/components/ui/day-mark/index.ts"
TOKENS = ROOT / "brand/design-system/project/tokens.json"
APP = ROOT / "src/lib/app.ts"
PUBLIC = ROOT / "public"
ASSETS = ROOT / "brand/design-system/project/assets/AppIcon"

# The box spans 4.6–31.6 on the mark's 36-unit square. Its centre (18, 18) goes to the icon's.
APP_SCALE = 2.15  # the box is 58% of a home-screen icon
MASKABLE_SCALE = 1.6  # the ink stays inside a maskable icon's safe circle (80%)
FAVICON_SCALE = 0.96  # the box is 26/32 of a favicon
APP_STROKE = 1.9  # the box's stroke, in mark units: heavier than the planner's 1.75
FAVICON_STROKE = 2.6  # heavier again, so it holds at 16px
APP_TICK = 4.2  # the tick's stroke, a marker's width (the Ticks set draws 4.5 inside a smaller box)
FAVICON_TICK = 5.2
FAVICON_RADIUS = 7


def mark_paths() -> tuple[str, str]:
    """The hand-drawn box and the Ticks set's great tick, as the planner draws them."""
    src = MARKS.read_text()
    box = re.search(r"BOX_PATH =\s*'([^']+)'", src)
    tick = re.search(r"ticks: \{\s*great: \{\s*path: '([^']+)'", src)
    if not box or not tick:
        sys.exit(f"app_icon: BOX_PATH or the great tick not found in {MARKS}")
    return box.group(1), tick.group(1)


def colours() -> dict[str, dict[str, str]]:
    """Each colour role's light and dark value."""
    found: dict[str, dict[str, str]] = {}

    def walk(node: object) -> None:
        if isinstance(node, dict):
            value = node.get("value")
            if isinstance(node.get("name"), str) and isinstance(value, dict) and "light" in value:
                found[node["name"]] = value
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(json.loads(TOKENS.read_text()))
    return found


def app_name() -> str:
    match = re.search(r"APP_NAME = '([^']+)'", APP.read_text())
    if not match:
        sys.exit(f"app_icon: APP_NAME not found in {APP}")
    return match.group(1)


def mark(scale: float, size: float, stroke: float, tick_width: float, box: str, tick: str) -> str:
    shift = round(size / 2 - 18 * scale, 3)
    line = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
    return (
        f'<g class="i" transform="translate({shift} {shift}) scale({scale})">'
        f'<path d="{tick}" {line} stroke-width="{tick_width}"/>'
        f'<path d="{box}" {line} stroke-width="{stroke}"/></g>'
    )


def app_svg(scale: float, box: str, tick: str, c: dict[str, dict[str, str]]) -> str:
    """A square home-screen icon in green; the phone rounds its corners. Light colours only."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f"<style>.g{{fill:{c['pen']['light']}}}.i{{stroke:{c['on-ink']['light']}}}</style>"
        '<rect class="g" width="100" height="100"/>'
        f"{mark(scale, 100, APP_STROKE, APP_TICK, box, tick)}</svg>\n"
    )


def favicon_svg(box: str, tick: str, c: dict[str, dict[str, str]]) -> str:
    """A 32-unit tab icon that follows the browser's light or dark theme."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f"<style>.g{{fill:{c['pen']['light']}}}.i{{stroke:{c['on-ink']['light']}}}"
        f"@media (prefers-color-scheme:dark){{.g{{fill:{c['pen']['dark']}}}"
        f".i{{stroke:{c['on-ink']['dark']}}}}}</style>"
        f'<rect class="g" width="32" height="32" rx="{FAVICON_RADIUS}"/>'
        f"{mark(FAVICON_SCALE, 32, FAVICON_STROKE, FAVICON_TICK, box, tick)}</svg>\n"
    )


def manifest(name: str, c: dict[str, dict[str, str]]) -> str:
    icons = [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {
            "src": "/icon-maskable-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable",
        },
    ]
    body = {
        "name": name,
        "short_name": name,
        "icons": icons,
        "background_color": c["pen"]["light"],
        "theme_color": c["pen"]["light"],
    }
    return json.dumps(body, indent=2) + "\n"


def sources() -> dict[Path, str]:
    """Every text file this script owns, with the content it should have."""
    box, tick = mark_paths()
    c = colours()
    app = app_svg(APP_SCALE, box, tick, c)
    fav = favicon_svg(box, tick, c)
    return {
        ASSETS / "tracker-icon.svg": app,
        ASSETS / "tracker-icon-maskable.svg": app_svg(MASKABLE_SCALE, box, tick, c),
        ASSETS / "tracker-favicon.svg": fav,
        PUBLIC / "favicon.svg": fav,
        PUBLIC / "manifest.webmanifest": manifest(app_name(), c),
    }


def rasterise() -> None:
    for tool in ("rsvg-convert", "magick"):
        if not shutil.which(tool):
            sys.exit(f"app_icon: {tool} is needed to write the PNGs (brew install librsvg imagemagick)")
    pngs = [
        (ASSETS / "tracker-icon.svg", PUBLIC / "apple-touch-icon.png", 180),
        (ASSETS / "tracker-icon.svg", PUBLIC / "icon-192.png", 192),
        (ASSETS / "tracker-icon.svg", PUBLIC / "icon-512.png", 512),
        (ASSETS / "tracker-icon-maskable.svg", PUBLIC / "icon-maskable-512.png", 512),
    ]
    for svg, png, px in pngs:
        subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), "-o", str(png), str(svg)], check=True)
    # favicon.ico: 16 and 32px, for whatever asks for /favicon.ico. rsvg ignores the dark media query.
    tmp = [PUBLIC / f".favicon-{px}.png" for px in (16, 32)]
    for px, out in zip((16, 32), tmp, strict=True):
        subprocess.run(
            ["rsvg-convert", "-w", str(px), "-h", str(px), "-o", str(out), str(PUBLIC / "favicon.svg")],
            check=True,
        )
    subprocess.run(["magick", *map(str, tmp), str(PUBLIC / "favicon.ico")], check=True)
    for out in tmp:
        out.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="fail when a generated file is stale")
    args = parser.parse_args()
    stale = [path for path, text in sources().items() if not path.exists() or path.read_text() != text]
    if args.check:
        for path in stale:
            print(f"stale: {path.relative_to(ROOT)} (run python3 scripts/app_icon.py)")
        return 1 if stale else 0
    ASSETS.mkdir(parents=True, exist_ok=True)
    for path, text in sources().items():
        path.write_text(text)
    rasterise()
    print("app_icon: wrote", ", ".join(str(p.relative_to(ROOT)) for p in sources()), "and the PNGs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
