# Mahjong 3D macOS Screen Saver

This folder contains the native macOS wrapper for the Mahjong 3D web screen
saver build.

## Architecture

`Mahjong3D.saver` is a Swift `ScreenSaverView` bundle that hosts the local Vite
screen saver build in a `WKWebView` over the custom `mahjong3d-saver://` scheme.
The saver has no network dependency; bundled files are served by
`WKURLSchemeHandler` from `Contents/Resources/Web`.

The web app remains the renderer and simulation presenter. The native wrapper
only handles:

- local resource loading;
- `ScreenSaverView` lifecycle;
- native frame delivery via `animateOneFrame()`;
- packaging, signing, and distribution.

Fullscreen screen saver mode uses `surface=screensaver`. In that mode the R3F
canvas uses `frameloop="never"` and advances from native frame callbacks through
`window.mahjongScreenSaver.renderFrame(timestampMs)`. This avoids relying on
browser `requestAnimationFrame`, which is not reliable in the Sequoia legacy
screen saver host.

Screen saver playback also uses the native frame event for replay advancement
and terminal round promotion. Worker-backed generation is disabled in the saver;
round generation and preloading use the no-worker fallback so the bundle works
entirely from local files.

## Implementation Notes

Several pieces of this setup are intentional and should not be treated as
incidental cleanup:

- `WKWebView` loads the app through `WKURLSchemeHandler`, not a `file://` URL.
  The custom origin keeps ESM chunks, SVG tile assets, and WASM-style resources
  under one bundled same-origin URL without adding a local HTTP server.
- `ScreenSaverView.animateOneFrame()` is the render clock for fullscreen saver
  mode. Swift calls `window.mahjongScreenSaver.renderFrame(performance.now())`;
  the web app dispatches a frame event; R3F advances its manual frame loop from
  that event.
- The frame bridge is guarded by `renderFrameInFlight` so the native host does
  not queue unbounded `evaluateJavaScript` calls if WebKit falls behind.
- `startAnimation()`/`stopAnimation()` are noisy. `stopAnimation()` schedules a
  debounced inactive state instead of immediately pausing the web app; teardown
  paths still force an immediate inactive update.
- Every native lifecycle update first writes
  `window.__mahjongScreenSaverNativeState`, then calls the React bridge if it is
  registered. React bootstraps from that global so early native calls are not
  lost while the bundle is still loading.
- Fullscreen saver playback intentionally ignores some host visibility noise:
  fullscreen `surface=screensaver` stays active even if WebKit reports the
  document hidden. The tiny System Settings preview can still pause when
  inactive.

Diagnostics and JavaScript errors are written to:

```text
~/Library/Containers/com.apple.ScreenSaver.Engine.legacyScreenSaver/Data/Library/Logs/Mahjong3D/screensaver.log
```

## Build

```sh
bash macos/scripts/build-saver.sh
```

The script runs `bun run build:screensaver`, compiles a universal Swift
`ScreenSaverView` bundle, signs it ad hoc by default, and writes:

```text
macos/build/Mahjong3D.saver
```

Set `SIGN_IDENTITY="Developer ID Application: ..."` to sign the `.saver` with a
Developer ID identity.

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
