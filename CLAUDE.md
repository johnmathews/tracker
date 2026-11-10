# Tracker

UI work follows the Notebook design system in `brand/design-system/` (see
[docs/brand.md](docs/brand.md)): use the design-system skill, build from the system's tokens and
components, and add a component to the system (card first) before using it in the app.

A visual change (a colour, size, spacing, type, a mark, a new component, screen or layout) starts
as a mockup in `brand/design-system/mockups/` and waits for John's pick before any code changes
(design-system skill, `references/mockups.md`; [docs/brand.md](docs/brand.md) §11).

Before handing over a change John can see, make sure the local stack is up, and start it if not.
Check the ports first: `lsof -nP -iTCP:5173 -iTCP:8000 -sTCP:LISTEN`. A server already running
from another checkout serves the wrong code. The API runs from `api/` with
`PUBLIC_ORIGIN=http://localhost:5173 COOKIE_SECURE=false DATA_DIR=./.data` (port 8000), and the
web app runs with `npm run dev` (port 5173). [README](README.md) §2 has the full commands. Start
each in the background. The local data lives in `api/.data` and holds John's account: never
delete or reset it. Run `uv run tracker-admin seed-demo` from `api/`, with the same environment, when
the current week has no marks; it only adds what is missing. Then give John the URL and say what
to try, before any commit or push.

## Shipping

- **Lands by:** direct push (after every CI step passes locally, one push to `main`, no PR)
- **Environments:**
  - production (https://tracker.itsa-pizza.com): CI passing on `main` runs the Docker workflow,
    which publishes `ghcr.io/johnmathews/tracker` and `tracker-api` as `latest`; What's Up Docker
    on the home server pulls them ([docs/deployment.md](docs/deployment.md)).
    Check: `gh run list --workflow docker.yml --branch main --limit 1` (the publish; the pull
    itself shows only in the live site's assets)
