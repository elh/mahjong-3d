# Mahjong 3D

Taiwanese Mahjong 3D infinite simulator made with React Three Fiber. Enjoy it
as a cozy [website](https://elh.github.io/mahjong-3d/) or [macOS screen saver](https://github.com/elh/mahjong-3d/releases/latest/download/Mahjong3D.dmg).

![screenshot](public/social-preview.png)

## What It Does

- Simulates Taiwanese 16-tile Mahjong.
- Renders a 3D scene with animated tile handling and a between-game transition.
- Includes a compact debug replay view for stepping through event logs by seed.

### Scope

- Taiwanese Mahjong variant only. Rule implementation may be incomplete.
- Bot implementation is very simple.
- This is not a playable client.

## Development

```bash
make install      # install dependencies
make dev          # start the Vite app
DEBUG=1 make dev  # enabled controls like `?view=debug` and `?seed=...` control
make good         # format check, lint, knip, types, tests, and build
```

### macOS Screen Saver

The native wrapper lives in `macos/` and bundles the Vite screen saver build
into a small app with an embedded Screen Saver extension. See
[macos/README.md](macos/README.md).

```bash
make install-screensaver
make package-saver
```

### Project Layout

```plaintext
.
├── src/
│   ├── sim/          Deterministic rules engine, event model, replay, invariants
│   ├── bots/         Bot interfaces and strategy
│   └── ui/           React UI and Three.js
├── public/tiles/     Mahjong tile SVG assets
└── macos/            Native macOS screen saver and packaging scripts
```

See [CONTRIBUTING](./CONTRIBUTING.md).

## Licensing

MIT. [Attributions](https://github.com/search?q=repo%3Aelh%2Fmahjong-3d+path%3A**%2FATTRIBUTION.md&type=code)
