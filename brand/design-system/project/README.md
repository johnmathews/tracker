## About this document

This is the Tracker design system. A design system is a product's design language (its colours, type, spacing, marks and the way it writes), plus the components built from it and the rules for using them. This design system is not the app's code, but the code follows it closely. The app's styles are generated from its tokens, and the app's components are built from its cards.

This document shows each part of the Tracker web app in light and dark. New screens are built off of this design system, and the app is checked against it. This document does not describe how the app works, the data model or the code itself. It is also not a picture of every screen.

## Introduction

Tracker should feel like a well-made notebook kept for years: plain, dependable and calm, with today and this week in one bold, obvious place and everything older quiet and dense.

Tracker is a weekly plan for exercise and diet: one row per exercise or food, one mark per day, and a day that turns green once it reaches the daily pick (while Daily goal is on, K85). A personal trainer could recommend it and use it with a client. It is (almost) as simple as a paper star chart, and it never pretends to be more than the record of someone showing up.

## The feeling

- **Simple and durable.** A tool for years of ordinary weeks. Nothing in it wears out or goes out of fashion: hairline rules, two typefaces, almost no shadow.
- **Rooted in now.** This week fills the screen. Nothing archival competes with it. This is what the whiteboard lends.
- **Quiet record.** Months and years sit below, small and dense. A week off shows as empty rings, plainly, without comment. This is what Apple Notes and the Moleskine lend: restraint and quality, not their look.
- **A mark per session.** The marker stroke is the whole reward: green for a day done well, yellow for part of one, red for a day tried and missed, all of them counted. No streaks, badges, confetti or slogans, and no guilt for a red one.

## Two layers, one system

| Layer | Where | How it behaves |
| --- | --- | --- |
| 1. Now | The Exercises and Food screens, each filling the screen | One obvious thing to do. The week fills the screen, the bar keeps out of sight, 44px targets. |
| 2. Record | The year strip, notes, search, an item's recent weeks | Quiet and dense: `caption` type, `ink-secondary`, small marks. |

## How to use this system

1. Read **Foundations** for colour, type, marks, shape and motion, and **Voice** for how the app writes.
2. Build from the components. Each one's guidelines say when to use it, its states, and what the consumer provides. If something is missing, add it to the system first (preview and README), then use it.
3. Use tokens by name (`var(--ink)`, `var(--radius-md)`, the `.caption` class). Never paste a raw value.
4. Check every screen in light and dark, and at 375px wide.

## Never

- Fake paper texture, handwriting fonts, leather, binding or any skeuomorphism.
- Confetti, streak flames, badges, points, motivational slogans, exclamation marks.
- The `pen` colours on anything but their marks (and `pen` on a met day's underlined name, K60, and on a met week's underlined count in RecentWeeks, K64).
- `pen-missed` standing in for `error-ink`: a missed day is a record, never an error.
- Uppercase letter-spaced labels, monospace numbers, gradients, glows, emoji.
