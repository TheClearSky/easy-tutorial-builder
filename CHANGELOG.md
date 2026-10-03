# Changelog

## 0.0.2 — 2026-10-03

Documentation only — no code changes.

- A new README: what it is and why, a screenshot of a real tour (watch-together's Pop), install entries, a quick
  start, recipes (React, drawing your own guide, a one-off spotlight, resuming), remote launch, an API table, and the
  projects that use it — with links to npm, GitHub and the sibling library.
- The first release published by CI with npm provenance.

## 0.0.1 — 2026-10-03

First release.

- `defineKit` / `defineTutorial`: the app's vocabulary (targets, events,
  predicates, assists, capabilities) and scripts typed against it.
- Scripts are DATA: steps `say`, `point`, `choice`, `branch`, `end`; `point`
  steps advance on real app events (with argument matching and counts) or
  conditions; `skipIf` on entry and while waiting; timeouts with hints;
  non-destructive assists; checkpoints.
- `createTutorial`: a framework-free controller — per-frame target tracking
  (pan/zoom and re-mount safe), an SVG spotlight with several holes that
  lets task clicks through, outside-click policy, failures, progress.
- `highlight`: a one-off spotlight.
- `./schema`: zod validation built from the kit (unknown names fail, exact
  error paths, size limits) and a JSON Schema for editors.
- `./remote`: start a tutorial sent from another tab over `postMessage` —
  the app speaks first, exact-origin allow-list, nonce, one request per
  load, a 512 KB cap, a queue that survives reloads, user consent.
- `./react`: `TutorialProvider`, `useTutorial`, `useTutorialView`.
