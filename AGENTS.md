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
- All kongs use `kongDeclared`; discard-claimed kongs use `kong: "claimed"` with `from` and `tile`.

## Test Fixtures

- Special `test-*` seeds are demo fixtures with prebuilt starting states, not normal RNG seeds. e.g. `test-concealed-kong`, `test-added-kong`, `test-multi-discard-win`, `test-eight-flower-win`.
- Normal `simulateRound()` must always respect caller-provided bots, even when the seed string looks like a fixture.
- Use `simulateTestScenarioRound()` when a test or UI route intentionally wants fixture state plus scripted fixture bots.
- Replay and 3D wall reconstruction may explicitly opt into fixture starting states and walls for known fixture seeds so those demos remain short and visually coherent.

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
- all 8 flowers/seasons is a win, and 7 flowers/seasons may rob another player's exposed 8th flower;
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
- Keep bot implementation doc comments current when strategy assumptions or supported/unsupported behavior change.

## UI Scope

- Compact debug viewer, not a landing page.
- Keep controls dense and stable on a 14 inch laptop at 100% zoom.
- Avoid layout shift while stepping events.
- Use tile images with rounded outlines; inline tiles are smaller.
- Derive highlighted tiles from the active event.
- Preserve keyboard navigation and hold-to-repeat event stepping.

## 3D Viewer Scope

- `src/ui/three/` is presentation-only; rules, bots, and replay semantics stay in `src/sim/`.
- The 3D view must derive tile positions and animations from replay snapshots/events, not independent UI state.
- Rapier physics is visual-only for discarded tiles; it must not feed back into rules or replay state.
- Keep the Canvas/Rapier world stable during loading and stepping. Prefer loading overlays and cached assets over remounting the 3D scene.
- Hidden debug/audio controls may exist behind explicit constants, but should not appear in the normal debug UI unless intentionally re-enabled.

## macOS Screen Saver Scope

- `macos/` should stay a minimal native wrapper around the existing React Three Fiber app.
- The wrapper's job is to make the web renderer run reliably as a macOS screen saver: local resource loading, ScreenSaver lifecycle, frame delivery, install/package/signing scripts.
- Keep committed macOS project files, signing settings, entitlements, and packaging details safe for a public OSS repository; do not commit private team IDs, credentials, profiles, or local absolute build artifacts.
- Keep rules, bots, replay semantics, and 3D presentation logic in the existing web code unless a native concern truly requires otherwise.
- See `macos/README.md` for screen saver architecture details, build commands, diagnostics, and packaging notes.

## Assets and Licensing

- Tile art lives in `public/tiles/`.
- Attribution must remain in `public/tiles/ATTRIBUTION.md`; UI attribution should stay minimal.
- Do not add third-party assets without checking license compatibility and attribution.

## Maintenance

Update this file when rules assumptions, event semantics, quality gates, asset licensing, or expected UI interactions change. Do not leave durable project decisions only in chat history.
