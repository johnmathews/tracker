# Programmes library and follow-ups

> Purpose
>
> Records the run of 2026-11-19 (engineering-team run `manual-20261119T155730Z`): a shared library
> of programmes (#88), Restart and Re-open in the app (#87), `paused-ink` in two more places (#90)
> and planned-break weeks (#91). The decisions are K167 to K177.

## 1. What changed

- **A shared library of programmes (#88, K171).**
  - The spec is `docs/specs/2026-11-19-shared-library.md`, approved by John on 2026-11-19.
  - An account with the admin flag (`users.admin`, schema 19, set by `tracker-admin admin <email>`)
    publishes a snapshot of one of its programmes into `shared_programmes`. Publish previews what
    everyone will see, notes and links included. Publishing again replaces the snapshot.
  - Any user copies a shared programme into their own library as a plain copy. A shared programme
    names no one, because a username is an email address.
  - The Library tab ends with "From the shared library". The admin's rows keep Publish, Publish
    again and Unpublish in a More menu, with a "Shared" chip on a shared row. John picked B and B
    in the mockup `261119-shared-library`.
  - Copy to library asks first, and the button then reads "Added to library" (K172). On his phone
    John copied the same programme several times without noticing: the success line sat at the
    top of the tab, off screen.
  - Preview on a shared row opens a Dialog with the plan and the activities, before any copy
    (K173). John asked how to look before copying; he picked the Dialog over the in-place frame.
    A new route, `GET /api/shared-programmes/{id}/preview`, computes the plan on the server.
  - A copy lands where it went (K174): the page scrolls to it, focus moves to its name, and the
    row slides in on a tile that fades. On a wide screen the open preview and the shared Preview
    dialog take the page's width (K175), after John's screenshot of a grid squeezed into 820px.
  - The shared programmes moved to a tab of their own, Reference (K177), John's name for it. Every
    page but the week now sits in a centred column of 960u (K176); the Settings mark sets wrap
    two to a row there.
  - Agents browse and copy with `list_shared_programmes` and `copy_programme`. Publishing stays in
    the app. Export and import leave the shared library out.
  - `seed-demo` adds one shared programme, "Base miles", with no publisher.
- **Restart and Re-open in the app (#87, K167, K168).**
  - New routes `POST /api/runs/{tracker}/restart` and `/reopen` preview by default and confirm with
    the preview's rev, as a run change does.
  - An ended-early run's overview offers Re-open programme and Restart from week 1. A run that ran
    to its end offers Restart only. A run with an end set for a later day swaps End programme for
    Cancel the end.
  - A restart now marks the old run's end as restarted, so that run can't be re-opened beside its
    replacement. The log reads "Restarted from week 1". This amends K164.
  - The overview and the item page both name an end by its last day, "Ended Sun 15 Nov.".
- **"Paused until" in red in the week and on the item page (#90, K169).** The item page's line now
  leads as the grid does: "Paused until Mon 28 Dec. Knee. It comes back at 45 kg."
- **A rest week (#91, K170).** "Paused" comes from a cell's state, never its goal. A running week
  with a goal of 0 reads "Rest week".

## 2. Found on the way

- **Copy to library failed against the real server.** The app sent the copy with no body, so no
  JSON content type, and the API refused it with 415. Unit tests missed it because the fake API
  doesn't check the header. The new e2e, built on replies saved from the real API, caught it.
  `request` now sends the content type on every write, body or not.
- **The e2e fixtures now use fixed ids,** so regenerating them gives the same files.
- The web End route has no preview by design (K156). Only the MCP tool previews an end.

## 3. Left for later

- #92: a week where every goal is 0 breaks the goal-week streak.
- #93: the grid's row heading can read "0 a week" when its reference week is a rest week, and the
  item chart draws nothing for a past rest week.
- After the deploy, John runs `tracker-admin admin <his email>` on the server.
