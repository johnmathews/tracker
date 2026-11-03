# Tracker

> Purpose
>
> A weekly workout and diet log: exercises and foods down the side, Monday–Sunday across the top,
> one click to tick a day. A Vue 3 + Vite single-page app (Tailwind CSS 4, shadcn-vue on Reka UI,
> built to the Notebook design system) with light and dark themes, and a Python API that keeps each
> person's data in sync across devices.

## 1. What it does

- **Exercises.** Each day, pick a few exercises (default three) and mark their cells. A press steps
  a day through green (done well), yellow (partly done) and red (tried and couldn't), first in a
  zigzag, then a solid fill, then a hatch, and back to empty: the colour says how it went, and the
  marker drawing is yours to choose. **Marks** in Settings swaps the squiggles for ticks (a tick, a
  circle, a cross) or faces (happy, so-so, sad), drawn in marker or stamped on a coloured box; a
  press then steps green, yellow, red and back to empty. Each exercise has a weekly goal of 0–7 days, set
  in its Edit dialog. A day whose marked exercises reach **Exercises a day** turns green: its
  name in the header goes green and is underlined.
- **Food.** The screen after the exercises works the same way, with one kind of mark: mark each day you ate
  one. Each food has a weekly goal, set in its Edit dialog. Defaults are Vegetables (7), Fruit (5),
  Fish (2) and Nuts (3). A day whose marked foods reach **Foods a day** (default two) turns green,
  as an exercise day does.
- **Normal mode and config mode.** The app opens in normal mode, where you only mark cells. The
  **Edit plan** button in the top bar turns on config mode for changing the plan:
  - a counter centred on each section's title line, reading "− 3 per day +", sets its daily
    target (1–8): exercises a day and foods a day. They are one setting for every week. The week isn't shown beside the titles in
    config mode, since the bar shows it;
  - **Add exercise** and **Add food**, under each grid, open the item's dialog with nothing in it:
    an exercise takes a name, optional sets, reps or a time in seconds (a plank), "Per set" or
    "Each side", an optional weight in kg (e.g. squats with a 12 kg kettlebell), a goal and a
    note; a food a name, a goal and a note;
  - the pencil beside a name opens that item's dialog, where everything about it changes: for an
    exercise its sets, reps or seconds, weight, note and goal ("Times a week"), for a food its
    name, note and goal. A note is markdown and is the same on every week; it shows under the
    item's name, and pressing it opens the whole note with its links; the bin at the end of a row
    removes the item after a confirmation (its marks stay stored). New items start with a goal of 3.
- **An item's own page.** Pressing an exercise's or a food's name, in either mode, opens its page.
  It reads in rows like Settings, each heading on the left and its content beside it. First come
  the notes, up to 20,000 characters of markdown, which save as you type. Then the details:
  equipment, what it works and a link for an exercise, and a serving and examples for a food. Then
  the week's plan for the item. Last come its last eight weeks, with how many days were marked
  against the goal; every mark counts, missed included. Notes and details are one copy for every
  week. **Arrange sections** chooses which of these every exercise page shows, and in what order,
  and the same for every food page; the choice is saved with your account. **Back to the
  week** returns to the name you pressed.
- **Weekly plans.** Each week has its own plan, so reps, sets, weights and goals can change from week
  to week. A week you haven't changed carries over the latest earlier week's plan; it gets its own
  copy the first time you change it or mark a cell. So a change to this week also reaches the weeks
  after it that you haven't changed yet.
- `‹` / `›` move between weeks for both sections; past weeks persist. **Print…** produces a
  sheet in the light theme's colours on white paper.
- **One screen per section.** The week fills the screen, and the bar stays out of sight until the
  pointer reaches the top edge (or the handle at the top centre is pressed). Scrolling brings Food,
  which takes the screen in turn: a flick jumps straight to it. An arrow at the foot of Exercises
  and the top of Food leads to the other. Held upright, a phone or an iPad folds the week: each row's name
  above its seven boxes. A day that reaches its daily target turns green.
- **Settings** is a page of its own. It sets how marks are drawn (Squiggles, Ticks, Stamped ticks,
  Faces or Stamped faces) and the theme (System, Light or Dark), keeps **Your goals** (what you
  are aiming for, in your own words, which only Ask reads; saved when you pause typing), holds
  export and import, and shows who is signed in, with **Sign out**.
- **Ask** is a page where you ask an AI (Claude) about what you track: whether you are doing too
  much or too little for your goals, whether your diet is good enough, how steady your weeks are.
  It reads your plans, marks, weekly goals, daily targets and Your goals, and the answer streams in
  as it is written, with a Stop button. It may say plainly that something is too little or too
  much, quote your goals and notes back, and count streaks. Each account may ask 30 questions in
  any 24 hours by default; a chip under the box says how many are left. **History**, a panel down the left
  (a drawer on a phone), keeps every conversation on the server, synced across devices and in the
  export: pick one to carry on, start a **New conversation**, or delete one or all. Ask shows in
  the bar only where the API has an Anthropic key (`docs/api.md` §3.2). Answers come from an AI
  and can be wrong, and aren't medical advice.
- **Accounts and sync.** Anyone can **Create an account** from the sign-in screen with an email and
  a password, or be invited by a link that names their email. Every account signs in with its email. Sign-up
  closes once `MAX_USERS` accounts exist (`docs/api.md` §4), and each account may store 5 MiB
  (§3). Where the API has a Resend key, a new account gets an email to **confirm** its address,
  and **Forgot your password?** emails a reset link (§4.1). Plans, marks, notes, details and the daily targets are
  stored on the server and sync across devices; the theme and the marks stay with each device. The app opens from a cached
  copy and keeps working offline, sending changes once the connection is back.
- **Export and import.** Settings → **Export** downloads your plans, marks, notes, details, daily
  targets, goals and Ask conversations as a JSON file; **Import…** merges such a file into your
  account. An import only adds: weeks you already have keep their plan, an item's notes and
  details stay as they are, no mark is ever cleared or changed, goals fill yours only when they
  are empty, and a conversation you already have stays as it is. The export is your own copy of
  your data.
- **Moving a log from before accounts.** A browser that kept a log before accounts existed offers
  it once you sign in: **Add to my account** merges it in, **Not mine** stops the question for you
  on that browser, **Later** asks next time. A log in another browser or profile can be moved with
  Export there and Import… here.
- **Ask an agent.** claude.ai and Claude Code connect to the API's MCP endpoint (`/api/mcp`) by
  URL and an OAuth sign-in. Claude Code, Claude Desktop and scripts can use a personal token
  instead, which you create in Settings › Connections. The agent reads how your weeks are going,
  as the app shows them, and with write access it can edit plans and marks.
  [docs/mcp.md](docs/mcp.md) says how to connect.

## 2. Getting started

Prerequisites: Node `22.18+` or `24.12+`, and **npm 11**. Node 24.12+ ships npm 11; on Node 22,
upgrade npm first, because the bundled npm 10.9 crashes while resolving this project's dependencies.

```bash
git clone https://github.com/johnmathews/tracker.git
cd tracker
npm install -g npm@11      # Node 22 only; or run: npx -y npm@11 ci
npm ci
npm run dev                # http://localhost:5173
```

The app needs the API to sign in. Run it alongside (Python 3.13 and [uv](https://docs.astral.sh/uv/)),
with `PUBLIC_ORIGIN` set to the dev server's origin. Then create an account at
<http://localhost:5173/#/signup>, or mint yourself an invite:

```bash
cd api && uv sync
export PUBLIC_ORIGIN=http://localhost:5173 COOKIE_SECURE=false DATA_DIR=./.data
uv run tracker-admin invite you@example.com          # prints http://localhost:5173/#/invite/…
uv run uvicorn --factory tracker_api.app:create_app_from_env --port 8000
```

For an account that already has data, seed the demo instead (same shell, any time; a second run
adds nothing):

```bash
uv run tracker-admin seed-demo                       # demo@example.com, password demo-password
```

It runs only against a local stack, and never overwrites a mark or a note. The database lives in
`api/.data` (git-ignored), so accounts and data survive restarts, rebuilds and branch switches;
deleting that folder, or `git clean -x`, starts over.

Vite forwards `/api` and the three OAuth discovery paths ([docs/api.md](docs/api.md) §3.3) to `http://127.0.0.1:8000` (set `API_URL` to change it). Open the invite link
from the dev server's own address: the API checks the `Origin` of every write, so
`http://127.0.0.1:5173` and `http://localhost:5173` are different origins.

Day-to-day commands:

```bash
npm test                   # Vitest suite (jsdom)
npm run test:coverage      # suite + coverage report in coverage/
npm run test:e2e           # Playwright browser checks: axe, phone width, focus
npm run lint               # oxlint + ESLint
npm run format             # Prettier
npm run type-check         # vue-tsc
npm run tokens             # regenerate src/styles/tokens.css from the design system
npm run build              # type-check + production build into dist/
npm run preview            # serve dist/ locally
```

In development, <http://localhost:5173/styleguide> shows the living style guide: every component
in each state, in either theme, with no sign-in needed.

[docs/development.md](docs/development.md) covers the toolchain, conventions and test layout, and
[docs/brand.md](docs/brand.md) the brand and the design system.

## 3. Deploy

Two containers: the app (static files on nginx, port **8080**) and the API (port **8000**), with
nginx forwarding `/api/` to the API so the browser sees one origin. CI publishes both as
multi-architecture images (`linux/amd64` and `linux/arm64`) to GHCR once CI passes on a push to `main`:

| Image                             | Tags                        |
| --------------------------------- | --------------------------- |
| `ghcr.io/johnmathews/tracker`     | `latest`, `sha-<short sha>` |
| `ghcr.io/johnmathews/tracker-api` | `latest`, `sha-<short sha>` |

Run them with Docker Compose. The API service must be named `fitness-api`, since that is the
host `nginx.conf` forwards to:

```yaml
services:
  web:
    image: ghcr.io/johnmathews/tracker:latest
    ports:
      - '8080:8080'
    restart: unless-stopped
  fitness-api:
    image: ghcr.io/johnmathews/tracker-api:latest
    environment:
      PUBLIC_ORIGIN: https://fitness.example.com # the address people open
      MAX_USERS: '50' # sign-up closes at this many accounts; '0' = invites only
      # Optional: email for confirming addresses and resetting passwords (docs/api.md §4.1)
      # RESEND_API_KEY: re_...
      # MAIL_FROM: Tracker <planner@fitness.example.com>
    volumes:
      - ./fitness-data:/data # owned by uid 10001
    mem_limit: 192m
    restart: unless-stopped
```

Create the data directory first, owned by the API's user. Docker would otherwise create it as
root, and the API (uid 10001) could not write its database:

```bash
mkdir fitness-data && sudo chown 10001:10001 fitness-data
```

Then start both, and create the first account at `/#/signup`, or mint one and open the link it
prints:

```bash
docker compose up -d
docker compose exec fitness-api tracker-admin invite <email>
```

Sign-up is open by default: anyone who can reach the address can create an account until 50
exist. Set `MAX_USERS` on the API to change the cap, or to `'0'` to allow invites only.

Serve it over HTTPS: the session cookie is `Secure`. For a plain-http trial, set
`COOKIE_SECURE: 'false'` on the API. Update with `docker compose pull && docker compose up -d`.
`GET /healthz` (nginx) and `GET /api/healthz` (the API) both return 200.
`docker compose up --build` in this repo runs both from source, serving the app on
`http://localhost:8083` (its `PUBLIC_ORIGIN`), and `scripts/compose-smoke.sh` checks the whole path
end to end.

[docs/deployment.md](docs/deployment.md) covers the images, nginx and CI, and
[docs/api.md](docs/api.md) the API, accounts, backups and `tracker-admin`.

## 4. Documentation

| Doc                                                                            | Covers                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                                   | Components, stores, storage format, design decisions                 |
| [docs/development.md](docs/development.md)                                     | Toolchain, scripts, conventions, tests                               |
| [docs/deployment.md](docs/deployment.md)                                       | Docker images, nginx, CI, GHCR publishing, sign-up, turning on email, Cloudflare for Claude |
| [docs/api.md](docs/api.md)                                                     | The API service: endpoints, accounts, email, CLI, backups            |
| [docs/mcp.md](docs/mcp.md)                                                     | Connecting an agent over MCP: OAuth, tokens, clients, example questions     |
| [docs/brand.md](docs/brand.md)                                                 | The brand, the design system and how to change them                  |
| [docs/decisions.md](docs/decisions.md)                                         | Why accounts, sync and the design system are built the way they are  |
| [docs/specs/2026-10-24-brand-design.md](docs/specs/2026-10-24-brand-design.md) | The approved brand spec (Notebook): intent, rules and calls K1–K8    |
| [design_handoff_exercise_planner/](design_handoff_exercise_planner/README.md)  | The original design spec and HTML prototype                          |

Development history lives in [`journal/`](journal/).
