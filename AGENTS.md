# Agent Guide

Concise project contract for future agents.

## Stack and Checks

- Bun, TypeScript, Vite, React.
- Use Bun for package management and scripts.
- Run `make good` before handoff. It checks format, lint, knip, types, tests, and build.
- Focused commands: `make dev`, `make test`, `make typecheck`, `make lint`, `make format`, `make build`.

## Architecture

- `src/sim/`: deterministic rules engine, state, wall, actions, events, invariants, replay, win checks.
- `src/bots/`: bot interfaces and baseline strategy.
- `src/ui/`: UI helpers, including tile image mapping.
- `src/sim/simulationWorker.ts`: full-round generation off the main thread.
- `src/App.tsx`: compact viewer/controller only. Do not put rules or bot logic in React.

Core rule: simulation state and event logs are the source of truth. UI state should be derived from replay snapshots where possible.

## Event Model

- Prefer explicit replayable events over implicit UI mutation.
- Setup/deal events use `phase: "setup"` and setup grouping.
- Turn events use `groupId: turn-${turn}`.
- Winning rounds end on `winDeclared`; drawn rounds end on `drawDeclared`.
- Do not add a generic terminal `roundEnded` viewer row.
- Event payloads must support replay and active-tile highlighting.
- Flower exposure is explicit via `flowerExposed`; do not rely on implicit UI mutation from `tileDrawn`.
- Chow claim actions carry the two consumed tile ids so ambiguous chows are replayable.

## Taiwanese Mahjong Scope

Target Taiwanese 16-tile Mahjong, not Riichi.

Implemented expectations:

- four players;
- East starts with 17 non-flower tiles; others start with 16;
- flowers/seasons are exposed and replaced from the dead wall;
- flower and kong supplements draw from the dead wall;
- each dead-wall supplement is replenished from the back of the live wall;
- concealed and claimed kongs draw a supplement before discard;
- added kongs from exposed pongs are supported;
- opponents may rob an added kong before it is finalized;
- multiple winners on one discard are allowed;
- wins include normal 5-sets-plus-pair and Taiwanese seven-pairs-plus-triplet;
- turn-boundary invariants catch illegal concealed hand counts.

Known simplification: wall layout is live/dead ordered arrays, not physical wall break, dice, side, or loose-tile geometry.

Deferred: Taiwanese scoring/tai/fan and house-rule variants.

## Bot Scope

Baseline bots should be legal and plausible, not optimal.

- Win when legal.
- Declare legal concealed kongs.
- Rank discards using hand shape, shanten-ish progress, live waits, and visible tile counts.
- Claim only with basic hand-shape justification; kongs are currently accepted.
- Avoid deep search and opponent modeling until explicitly requested.

## UI Scope

- Compact debug viewer, not a landing page.
- Keep controls dense and stable on a 14 inch laptop at 100% zoom.
- Avoid layout shift while stepping events.
- Use tile images with rounded outlines; inline tiles are smaller.
- Derive highlighted tiles from the active event.
- Preserve keyboard navigation and hold-to-repeat event stepping.

## Assets and Licensing

- Tile art lives in `public/tiles/`.
- Attribution must remain in `public/tiles/ATTRIBUTION.md`; UI attribution should stay minimal.
- Do not add third-party assets without checking license compatibility and attribution.

## Maintenance

Update this file when rules assumptions, event semantics, quality gates, asset licensing, or expected UI interactions change. Do not leave durable project decisions only in chat history.
