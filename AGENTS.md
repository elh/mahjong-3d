# Agent Guide

## Project

This repository is a Bun, TypeScript, Vite, and React project for simulating Taiwanese-style 16-tile Mahjong. The app watches deterministic bot games through replayable event logs. The simulator is the source of truth; React is only a viewer/controller over generated logs.

Current priorities:

- keep the rules loop legal, deterministic, and well tested;
- keep game generation off the main UI thread;
- keep the viewer compact enough for a 14 inch MacBook at 100% zoom;
- improve baseline bot quality only as far as shanten, waits, and visible-tile heuristics.

## Development Commands

Use Bun for package management and scripts.

```sh
make good
```

`make good` is the standard pre-handoff gate. It runs format check, Biome lint, ESLint, Knip, TypeScript, tests, and production build.

Useful focused commands:

```sh
make dev
make test
make typecheck
make format
make lint
make knip
make build
```

When touching UI or worker bundling, run `make build` even if TypeScript passes. When touching simulator behavior, run `make test` at minimum.

## Architecture

- `src/sim/` owns rules, game state, wall generation, legal actions, turn flow, win checks, invariants, replay, and event types.
- `src/bots/` owns bot strategy interfaces and implementations.
- `src/ui/` owns UI-specific helpers such as tile image mapping.
- `src/sim/simulationWorker.ts` runs full-round generation in a Web Worker so page load and seed changes do not block React.
- `src/App.tsx` should stay a compact viewer/controller. Avoid moving rules or bot logic into React.

The simulator should expose deterministic functions whose output is reproducible from a seed. UI code should consume event logs and replay snapshots; it should not mutate game truth directly.

## Event Model

Prefer explicit events over implicit UI state. Important event conventions:

- setup/deal events use `phase: "setup"` and are grouped as `setup`;
- turn events use `groupId: turn-${turn}`;
- winning rounds end on `winDeclared`;
- drawn rounds end on `drawDeclared`;
- do not add a generic terminal `roundEnded` row to the viewer log;
- keep event payloads sufficient for replay and UI highlighting.

If a new UI feature needs state, first ask whether that state should be derived from replay rather than stored independently.

## Mahjong Rules Scope

Target Taiwanese 16-tile Mahjong, not Riichi.

Current rules expectations:

- four players;
- East starts with 17 non-flower tiles, other players with 16;
- flowers/seasons are exposed and replaced from the dead wall;
- supplement draws for flowers and kongs come from the dead wall;
- after each supplement draw, the dead wall is replenished from the back of the live wall;
- concealed kongs and claimed kongs draw a supplement before discard;
- multiple winners on one discard are allowed;
- win checks include normal 5 sets plus pair and Taiwanese seven pairs plus a triplet;
- invariant checks should catch illegal concealed hand counts at turn boundaries.

Known simplification: the wall is modeled as live/dead ordered arrays, not as a physically exact wall break, side, dice, or loose-tile layout.

Planned subsystem: Taiwanese scoring/tai/fan and house-rule variants. Do not mix scoring into the core turn loop until the rules loop remains stable.

## Bot Strategy Scope

Bots receive visible state plus legal actions and return one legal action. Baseline bots should play legal, plausible Mahjong:

- win when a legal win is available;
- declare legal concealed kongs;
- use shanten-ish hand shape and live waits for discard ranking;
- use visible tile counts to devalue exhausted waits;
- claim only with basic hand-shape justification, except kongs are currently accepted.

Do not pursue deep search, opponent modeling, or optimal AI yet. Keep the bot fast enough that full-round generation remains comfortable in the worker and tests.

## UI Guidance

The viewer is a compact operational tool, not a landing page.

- Keep controls dense and predictable.
- Keep wall, current event, event list, and player panels visible without large decorative areas.
- Avoid layout shift while stepping events; use stable heights for dynamic event text.
- Tile displays should use image assets with consistent rounded outlines.
- Inline event tiles should be smaller than table/wall tiles.
- Prefer deriving highlighted tiles from the active event.
- Preserve keyboard navigation and hold-to-repeat stepping behavior for event controls.

## Assets and Licensing

Tile art lives under `public/tiles/` and is adapted from DemChing/Cangjie6. Keep attribution minimal in the UI and complete in `public/tiles/ATTRIBUTION.md`.

Do not reintroduce untracked third-party tile sets without checking license compatibility and attribution requirements.

## Goal Tracking and Self-Maintenance

When new goals, rule decisions, or architectural constraints emerge, keep this guide current. Update `AGENTS.md` in the same change when:

- a new subsystem is introduced;
- simulator event semantics change;
- a Mahjong rule assumption is added, removed, or clarified;
- required development commands or quality gates change;
- asset licensing or attribution changes;
- UI interaction conventions become expected behavior.

For larger future work, add or update a short project-tracking note before implementation. Prefer a simple Markdown section or file with:

- goal;
- current decision;
- affected modules;
- test expectations;
- known follow-ups.

Do not let important rules or workflow knowledge live only in chat history.
