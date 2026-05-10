# Agent Guide

## Project

This repository is a Bun, TypeScript, Vite, and React project for simulating Taiwanese-style 16-tile Mahjong. The first milestone is a deterministic headless simulator with baseline bots and replayable event logs. The UI should remain a viewer over those logs, not the source of game truth.

## Engineering Guardrails

- Use Bun for package management and scripts.
- Use TypeScript throughout.
- Keep game logic framework-independent and deterministic.
- Keep React and Vite UI code separate from simulation logic.
- Prefer explicit game events over implicit UI state mutation.
- Treat Taiwanese 16-tile Mahjong as the target ruleset.
- Implement basic good strategy first; do not optimize deeply before the rules loop is reliable.
- Keep tests close to simulation behavior and fixed-seed determinism.

## Architecture

- `src/sim/` owns rules, game state, wall generation, legal actions, turn flow, win checks, and event logs.
- `src/bots/` owns bot strategy interfaces and implementations.
- `src/ui/` owns React viewer components.
- `src/App.tsx` and `src/main.tsx` should stay thin.

The simulator should expose pure functions or deterministic classes whose output is reproducible from a seed. UI code should consume snapshots or event logs emitted by the simulator.

## Mahjong Rules Scope

The current rules target a core Taiwanese 16-tile flow:

- four players;
- 16 concealed hand tiles per player after the deal;
- a player has 17 non-flower tiles while deciding a discard after draw or claim;
- suited tiles, honors, and flower tiles in the wall;
- flower tiles are exposed and replaced when drawn;
- basic draw, discard, claim, win-check, and round-end flow.

Detailed Taiwanese scoring, tai/fan calculation, and house-rule variants are planned subsystems and should not be mixed into the first rules loop.

## Bot Strategy Scope

Bots should receive visible state plus legal actions and return one legal action. The baseline bot should play legal, plausible Mahjong:

- win when a legal win is available;
- claim only when the claim improves hand shape enough to justify it;
- discard isolated or exhausted-value tiles before useful pairs, sequences, and honor pairs;
- use visible tile counts to lower the value of waits that are unlikely to complete.

## Testing Expectations

Before handing off simulator changes, run:

```sh
bun test
bun run typecheck
```

For UI changes, also run:

```sh
bun run build
```

