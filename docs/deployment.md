# Deployment

> Purpose
>
> How the app and its API are built into containers, what they serve, and how CI publishes them.

## 1. Image

`Dockerfile` has two stages. The `node:22-alpine` stage installs npm 11, runs `npm ci`, and runs
`npm run build`, which fails on a type error or a bundling error. It is pinned to `$BUILDPLATFORM`:
static files are identical for every target, so it runs once, natively. The runtime stage is
`nginxinc/nginx-unprivileged:1.29-alpine`, which runs as the non-root `nginx` user (uid 101) on port
**8080**. `.dockerignore` keeps dependencies, build output, git and CI metadata, docs, the journal,
the design handoff, local tooling directories, `api/` and `fixtures/` out of the build context.

The image is multi-architecture (`linux/amd64`, `linux/arm64`). Only the runtime stage is assembled
per target, and it holds nothing but `COPY` steps, so no QEMU emulation is needed.

```bash
docker build -t tracker .        # host architecture, loaded locally
docker run -p 8080:8080 tracker
```

To check both platforms build, run
`docker buildx build --platform linux/amd64,linux/arm64 -t tracker .`. A multi-platform
result stays in the build cache unless the builder supports loading it (Docker Desktop with the
containerd image store) or `--push` sends it to a registry.

**The API image** (`api/Dockerfile`, context `api/`) also builds without QEMU. Its build stage
runs on the build machine's platform and has uv install the locked dependencies as wheels for the
target (`x86_64-` or `aarch64-manylinux_2_28`). Every dependency ships binary wheels for both,
so nothing compiles. The runtime stage is `python:3.13-slim`, running as uid 10001 with `/data`
as its volume and uvicorn on port **8000**. `tracker-admin` is on the `PATH`, and the `HEALTHCHECK`
calls `/api/healthz` with Python's `urllib` (the slim image has no curl).

**Time zone.** `TIMEZONE` (default `Europe/Amsterdam`, [api.md](api.md) §6) is the zone in which
the MCP tools count today and this week. The container's clock stays in UTC. The slim image
ships the IANA zone files (checked on 2026-11-01, and on every build by the arm64 smoke test), so
any zone name works, and an unknown one stops the API at startup, as any bad setting does.

**Memory.** Measured on the API image on 2026-10-24 by reading the container's
`memory.peak` cgroup file:

| State                                              | Peak    |
| -------------------------------------------------- | ------- |
| idle after start                                   | 43 MiB  |
| one argon2 hash (invite redemption)                | 107 MiB |
| three sequential logins, then four concurrent ones | 109 MiB |

The four concurrent logins finished at 37, 67, 95 and 123 ms. The hashing semaphore runs them one
after another, so the peak stays at one hash's 64 MiB.

The MCP SDK raised these on 2026-11-01. Measured the same way, after a sign-up, a login and ten
MCP tool calls, the peak was 126 MiB in three runs. On the image before MCP it was 108–111 MiB.
Resting memory rose from about 44 MiB to about 60 MiB. One run, the first start after a build,
read 140 MiB. Give the API **`mem_limit: 160m`** at least; 192m leaves room for that first start. The web
container's 64m would be killed by the first login.

`docker compose up --build` runs both images locally: the app on `http://localhost:8083` and the API
on `http://localhost:8000`, with the API's data in the `api-data` volume. Create a first account at
`http://localhost:8083/#/signup`, or mint an invite with
`docker compose exec fitness-api tracker-admin invite <email>`.

Sign-up is open by default: anyone who can reach the app can create an account until `MAX_USERS`
(default 50) exist. Set `MAX_USERS: '0'` on the API to keep it to invites ([api.md](api.md) §4 and
§6).

## 2. nginx

`nginx.conf` serves `dist/` and proxies the API:

- `/api/*`: forwarded to `fitness-api:8000`, the API container, on the same Docker network. The
  upstream is a variable resolved through Docker's DNS (`resolver 127.0.0.11`), so nginx starts and
  keeps serving the app while the API is down. `/api/` then answers 502, or 504 within 3 seconds
  while nginx still holds the stopped container's address (`proxy_connect_timeout 3s`); the client
  treats both as offline. Bodies are capped at 6 MiB, the API's limit for an import; the API holds every other write to 1 MiB. The API's own `Cache-Control` is
  hidden and the server-level `no-store` sent instead, so each response carries exactly one.
- `/assets/*`: hashed bundles with `Cache-Control: public, max-age=31536000, immutable`; a missing
  asset returns 404 rather than falling back.
- Everything else gets `Cache-Control: no-cache`, so a new deploy takes effect on the next load.
  Unknown paths fall back to `index.html`.
- `/healthz` returns `200 ok`; the image's `HEALTHCHECK` polls it with BusyBox `wget`.
- Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a
  Content-Security-Policy of `default-src 'self'`. `style-src` also allows `'unsafe-inline'`, which
  the production bundle no longer needs: it writes no `style` attribute into markup and adds no
  `<style>` element. Its inline styles all go through the CSSOM, which CSP does not govern:
  Reka UI positions the popover through a Vue `:style` binding (which writes `element.style`), and a dialog
  locks scrolling through `document.body.style`. Dropping it is a change to `nginx.conf` and to
  `nginx.spec.ts`, which pins the policy.
- gzip compresses HTML, CSS, JavaScript and SVG.

All headers are set once at server level; `Cache-Control` varies through a `map` on `$uri`. A
`location` that declared its own `add_header` would silently drop the inherited ones.

## 3. CI and publishing

| Workflow                           | Trigger                           | Does                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml` `check` | pull request, push to `main`      | lint, format, types, tests with coverage, build, the design-system gate, and "tokens.css is current" (`npm run tokens`, then `git diff --exit-code src/styles/tokens.css`)                                                                                  |
| `.github/workflows/ci.yml` `e2e`   | pull request, push to `main`      | installs Chromium and runs `npm run test:e2e` (Playwright with axe, §3.3 of [development.md](development.md)): a 10-minute timeout, one retry for a failing test, and `test-results/` uploaded as the `playwright-traces` artifact (kept 7 days) on failure |
| `.github/workflows/ci.yml` `api`   | pull request, push to `main`      | ruff, mypy, pytest with coverage, `pip-audit`                                                                                                                                                                                                               |
| `.github/workflows/docker.yml`     | pull request, CI passed on `main` | `build` and `compose` on PRs; `publish` only after CI succeeds on a push to `main`; build and publish run once per image                                                                                                                                    |

`build` and `publish` build `linux/amd64` and `linux/arm64` for each image, so a PR proves the
multi-arch build before `main` publishes it; `compose` builds for the runner's own architecture. For the API, the PR build also smoke-tests each architecture: the amd64
image must answer `/api/healthz`, and the arm64 image, run under QEMU, must import its native
modules. The `build` job builds without pushing and holds only `contents: read`. The `publish` job
is the only one granted `packages: write`. It logs in to `ghcr.io` with `GITHUB_TOKEN` and pushes
`ghcr.io/johnmathews/tracker` and `ghcr.io/johnmathews/tracker-api`, each tagged
`latest` and `sha-<short sha>`. `publish` runs on `workflow_run` after the `CI` workflow succeeds
on a push to `main`, and checks out, tags and labels exactly the commit CI passed
(`workflow_run.head_sha`; `github.sha` would be the default branch's newest commit). The home server auto-deploys `latest` (What's Up Docker), so a red
commit must never publish. Every checkout sets `persist-credentials: false`. Before
2026-10-24 the project was called exercise-planner and published `exercise-planner` and
`exercise-planner-api`; until 2026-10-26 it was fitness-planner and published `fitness-planner` and
`fitness-planner-api` (K44). Those images still exist but no longer update, so a host's compose
file must pull `tracker` and `tracker-api`, or it silently stops getting deploys.

### 3.1 Item details: the API first (2026-11-01)

The release that adds item details (P26 in [decisions.md](decisions.md)) needs `tracker-api`
updated before `tracker`. Both images publish from the same CI run, so pull and restart the API
first, then the web.

- **Why the API first.** The new app saves notes and fields with `PUT /api/details/…`, which an
  older API answers 404. The app keeps that write and every write queued behind it, retrying with
  the backoff (`sync.ts`, P28), so nothing is lost. Syncing stalls until the API is updated, and the
  app shows itself as offline with the changes waiting.
- **Migrations 7 and 8 run when the API starts.** `db.migrate` runs in the app's startup, and in
  every `tracker-admin` command, before anything is served. Each step commits with its schema
  version under the write lock, so the API and a `tracker-admin` command starting together can't
  both apply it. A database not yet at step 6 (`api_tokens`, the MCP release) takes it first.
  Step 7 creates `item_details` and copies each item's latest note into it ([api.md](api.md) §2).
  Step 8 adds the nullable `settings.item_sections` (each type's item-page arrangement, K66);
  existing rows read as NULL, every page as it was.
- **Settings from the new app reach an older API safely.** An API from before step 8 ignores the
  `itemSections` key, so an arrangement made before the API updates is not saved there and the
  next read puts the pages back to the default. Updating the API first avoids it. Once it is
  updated, a tab on the old app sends settings without `itemSections`, and the API keeps the saved
  arrangement.
- **Treat it as one-way.** Rolling the API back leaves `item_details` unused. Plans keep their
  notes in `items_json` only until each plan is next written through the new API, so after a few
  days of use an older API would show most notes as gone.
- **Tabs on the old app.** Until a browser loads the new app (nginx sends `index.html` with
  `no-cache`, so the next load does), a tab still open on the old code shows no notes, and a note
  edited there is dropped, because the new API keeps no notes on plan items.

## 4. Data and hosting

Each user's data lives in the API's SQLite database (`api.md` §2), backed up daily with
`VACUUM INTO` and by PBS. Each browser keeps a per-user cache in `localStorage` so the app opens
instantly and works offline (`architecture.md` §7). Moving to a new hostname now only costs that
cache: signing in again fetches everything from the server. Settings → Export still saves a JSON
copy of one person's data.

**Email** (`api.md` §4.1) is off until the API gets `RESEND_API_KEY` and `MAIL_FROM`. To turn it
on:

1. In Resend, add the sending domain. This planner sends from `fitness.itsa-pizza.com`, its own
   subdomain, which keeps the root domain's mail reputation apart.
2. Add the records Resend shows in Cloudflare, all **DNS only**, with the names exactly as Resend
   gives them: a TXT for DKIM and an MX and a TXT (SPF) for bounces. For the root domain they are
   `resend._domainkey` and `send`; for a subdomain they carry it: here `resend._domainkey.fitness`
   and `send.fitness`. Wait until Resend says the domain is verified.
3. Create an API key with **sending access**, limited to that domain, and keep it in the
   home-server vault; the compose template passes it to `fitness-api` with
   `MAIL_FROM=Tracker <planner@fitness.itsa-pizza.com>`.
4. Redeploy the API. `GET /api/auth/options` then answers `{"mail": true}`, and the sign-in screen
   shows "Forgot your password?".

A failed send never shows to the person; it is logged by the API as `confirm email not sent` or
`reset email not sent` with Resend's answer, so `docker logs fitness-api` is the place to look.
Resend's own dashboard lists every email it accepted.

**Ask** (`api.md` §3.2) is off until the API gets `ANTHROPIC_API_KEY`. To turn it on:

1. In the Anthropic Console, create an API key for Tracker in a workspace of its own, so its
   usage and limits stand apart.
2. In the same workspace, set a monthly spend limit. The app caps questions (`ASK_PER_DAY` per
   account and `ASK_PER_DAY_TOTAL` for everyone), but the Console's limit is the one that holds
   whatever the app does.
3. Keep the key in the home-server vault, and have the compose template pass it to `fitness-api`
   as `ANTHROPIC_API_KEY`. `ASK_MODEL`, `ASK_PER_DAY` and `ASK_PER_DAY_TOTAL` keep their defaults
   unless set. Leave `ANTHROPIC_LOG` unset: at `debug` the SDK logs every request body.
4. Redeploy the API. `GET /api/auth/options` then answers `"ask": true`, and the app shows Ask.

Each question logs its rounds with Anthropic's request ids and token counts, and a line
`ask ended stop=… rounds=…` with the totals; none holds what was asked or answered. A line
`ask upstream refused` at error level usually means a bad or revoked key. Unsetting the key and
redeploying turns Ask off again; nothing else changes.

For a local stack, `docker-compose.yml` passes `ANTHROPIC_API_KEY` from the shell that runs it,
and leaves Ask off when the shell has none. A local API started with `uv run uvicorn` reads it the
same way.

The web container must reach the API as `fitness-api` on a shared Docker network: `nginx.conf`
names that host. `docker-compose.yml` does this locally, and the home-server compose file does it
in production.

`scripts/compose-smoke.sh` builds and starts both images with `docker-compose.yml` and checks the
whole path through nginx:

- a user redeems a `tracker-admin` invite, writes a tick and reads it back;
- a write from a foreign `Origin` gets 403;
- with the API stopped, `/api/` answers 502 or 504 within seconds while nginx still serves the app.

CI runs it on every pull request (the `compose` job in `docker.yml`); locally it takes about a
minute and leaves nothing running.
