# Mahjong 3D macOS Screen Saver

This folder contains the native macOS wrapper for the web screen saver build.

## Current Status

This is a working checkpoint for the native wrapper and local bundle build, but
it is not ready for public distribution until fullscreen animation quality is
fixed and the saver is verified end to end on macOS Sequoia.

The current implementation keeps the `.saver` architecture: a Swift
`ScreenSaverView` hosts a local `WKWebView` over the custom
`mahjong3d-saver://` scheme. Screen saver mode uses the bundled Vite build, no
network, no module workers, no preloading, and conservative render settings.

The initial Sequoia tests showed that the small System Settings thumbnail
preview animated, while fullscreen preview loaded the bundled web app but either
stayed on `Loading...` or rendered only the background. Diagnostics showed:

- the fullscreen `WKWebView` loads `mahjong3d-saver://app/index.html?surface=screensaver`;
- round generation completes without the module worker;
- tile face textures finish loading;
- DOM, CSS, raw 2D canvas, raw WebGL, and imperative Three probes render in
  fullscreen;
- R3F can create WebGL2 renderers in fullscreen, but its normal
  `requestAnimationFrame` loop does not reliably present frames inside the
  Sequoia legacy screen saver host.

Diagnostic builds using `surface=screensaver-r3f-diagnostic` proved the
important path forward:

- JS `setInterval` rendering makes R3F visible in fullscreen, but is throttled
  to roughly 2 FPS by the screen saver host;
- native `ScreenSaverView.animateOneFrame()` delivering
  `mahjongScreenSaver.renderFrame(performance.now())` into the web bridge makes
  the R3F diagnostic animate at native screen saver speed.

The current real saver build loads `surface=screensaver` again. In that path,
`ThreeGameView` uses `frameloop="never"` and advances R3F from native
`animateOneFrame()` so the table, tiles, and auto-orbiting camera render in
fullscreen. Replay advancement also uses the native frame event because both
`setTimeout` and `requestAnimationFrame` proved unreliable for gameplay
scheduling inside the Sequoia screen saver host.

The remaining blocker is animation quality. The game now progresses, but tile
movement is choppy: drawn tiles and discarded tiles appear to jump to their next
placement instead of showing continuous in-flight motion. The next investigation
should focus on where tile animation state still depends on browser RAF, React
commit timing, or event-index transitions that are too coarse for the native
frame driver. The native lifecycle debounce and
`window.__mahjongScreenSaverNativeState` bootstrap should stay, because they
protect startup and teardown when ScreenSaverEngine sends early
`stopAnimation()` calls.

If fullscreen regresses, test `?surface=screensaver-diagnostic` in the same
native wrapper to isolate WebKit/ScreenSaver behavior from Three/Rapier.

Diagnostics are written to:

```text
~/Library/Containers/com.apple.ScreenSaver.Engine.legacyScreenSaver/Data/Library/Logs/Mahjong3D/screensaver.log
```

## Build

```sh
bash macos/scripts/build-saver.sh
```

The script runs `bun run build:screensaver`, compiles a universal Swift
`ScreenSaverView` bundle, and writes:

```text
macos/build/Mahjong3D.saver
```

Set `SIGN_IDENTITY="Developer ID Application: ..."` to sign the `.saver`.

## Package

```sh
bash macos/scripts/package-dmg.sh
```

The package script creates:

```text
macos/build/Mahjong3D.dmg
```

Optional notarization:

```sh
SIGN_IDENTITY="Developer ID Application: ..." \
NOTARY_PROFILE="notarytool-keychain-profile" \
bash macos/scripts/package-dmg.sh
```
