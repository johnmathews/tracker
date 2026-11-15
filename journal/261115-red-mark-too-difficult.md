# A red day is too difficult

> Purpose: why the red mark changed in the tick and face sets, and why Week title moved to the
> top of Settings › Appearance.

## 1. What changed

- **Ticks and Stamped ticks:** a red day is a wave (~), one hand-drawn stroke, in place of the
  cross (K134). After trying it locally, John made the yellow circle the same wave in yellow
  (K137).
- **Faces and Stamped faces:** a red day is the so-so face in red, in place of the sad face
  (K135).
- **Words:** a red day is "too difficult" in place of "couldn't do it": in the accessible names,
  RecentWeeks and ItemPage history, the MCP tool help and the docs (K134). The stored kind is
  still `missed`, so no data, API field or export changes.
- **Settings › Appearance:** Week title, then Marks, then Theme (K136).

## 2. Why

John read a red cross as "didn't happen". A red day means he showed up and it was too difficult.
The 261101 journal had already noted that he reads red as "this was very difficult"; the words
waited until now.

## 3. The trade-off John chose

Partial and too difficult now share a shape in both symbol sets (the wave, the so-so face) and
differ by pen alone, as they do in the squiggles. Great keeps its own shape. The mockup showed
the open-mouth faces (2A, 2B) beside the red so-so face, and the colour-only cost was put to him
before the build. He kept the so-so face, then chose the
same for the tick sets.

## 4. Process

- Mockup `brand/design-system/mockups/261115-red-mark-too-difficult`, three rounds; the third
  came from John trying the app locally.
- One unit, no plan file: a small change run straight from the mockup.
- Shipped as `a996ebf` by direct push to `main` after every CI step passed locally. CI on `main`
  (run 43763818740): `check`, `api`, `e2e` green. Docker run 43764353626: `publish (web)` and
  `publish (api)` green at 22:34 CET (confirmed). The live site picking up the image was not
  checked.
- The design-system artifact was republished as version 87 (`b0d3240`). None of the live files
  had been edited on the page since the last release (hashes matched).
- A docs audit in `/done` found two stale mentions of the old Appearance order:
  `docs/architecture.md` and the Tabs card's sample copy. Both were fixed afterwards.

## 5. What is deliberately not done

- **The stored kind stays `missed`.** Renaming it would touch the database, the API, the MCP
  tools and every export version for a word the person never sees.
- **K131's row is not edited** to drop "after Theme". It is history, and K136 amends it.
- **Older mockups keep their crosses and sad faces.** They record what was decided then.
- **Ask's prompt still says "missed days".** That is the kind's name in the tools' data, and the
  prompt already asks for missed days to be reported without blame.
