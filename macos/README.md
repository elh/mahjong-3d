# Mahjong 3D macOS Screen Saver

This folder contains the native macOS wrappers for the Mahjong 3D web screen
saver build.

## Architecture

The default Tahoe/Sonoma-era artifact is `Mahjong3D.app`, a minimal SwiftUI
container app with an embedded `Mahjong3DScreenSaverExtension.appex`. The
extension uses the `com.apple.screensaver` app-extension point and hosts the
local Vite screen saver build in a `WKWebView` over the custom
`mahjong3d-saver://` scheme.

This structure follows the approach documented by
[AerialScreensaver/AppexSaverMinimal](https://github.com/AerialScreensaver/AppexSaverMinimal):
an application bundle owns and registers a sandboxed `XPC!` screen saver
extension. The private `ScreenSaverExtension` and `ScreenSaverViewController`
declarations in this repo are adapted from that MIT-licensed sample.

The legacy `Mahjong3D.saver` bundle is still available as an explicit fallback
for older macOS versions. It is no longer the default install or package path.

The web app remains the renderer and simulation presenter. Native code only
handles:

- local resource loading;
- screen saver extension lifecycle;
- native frame delivery;
- install, registration, signing, and packaging.

## Implementation Notes

- The extension loads the web app from `Contents/Resources/Web` through
  `WKURLSchemeHandler`, not `file://`, so ESM chunks and tile assets share one
  bundled same-origin URL.
- `SSENeedsAnimationTimer` is `false`. The extension currently avoids native
  per-frame JavaScript calls; the web app drives screen saver frames with
  `requestAnimationFrame` after the native lifecycle bridge marks it active.
- On macOS 14 and newer, the extension sets `WKPreferences.inactiveSchedulingPolicy`
  to `.none` as a best-effort guard against WebKit suspending an attached screen
  saver web view.
- Startup and teardown are anchored to `viewDidMoveToWindow()` following the
  Aerial minimal sample. There are no independent overlay windows, process-exit
  watchdogs, duplicate renderer ownership systems, or WebGL mirror fallbacks in
  this implementation.
- The native bridge still writes `window.__mahjongScreenSaverNativeState` before
  calling `setActive` or `setPreview`, so React can bootstrap from early native
  state.
- Worker-backed round generation is disabled in `surface=screensaver`; the web
  app uses the local-file-safe no-worker fallback.
- The container app is intentionally small. It shows extension registration
  status and offers Register, Unregister, Refresh, and Screen Saver Settings
  actions. It does not embed a preview renderer.

## Build

```sh
bash macos/scripts/build-screensaver-app.sh
```

The script runs `bun run build:screensaver`, builds `macos/Mahjong3D.xcodeproj`
with `xcodebuild`, copies the generated web app into the embedded extension,
adds thumbnails, signs the nested appex and app, verifies codesigning, and
writes:

```text
macos/build/Mahjong3D.app
```

Set `SIGN_IDENTITY="Developer ID Application: ..."` to sign the app and
extension with a Developer ID identity. Without it, the build uses ad-hoc
signing for local testing.

## Install Locally

```sh
make install-screensaver
```

The default install target builds `Mahjong3D.app`, copies it to
`/Applications/Mahjong3D.app`, removes stale user-level and system-level
`Mahjong3D.saver` installs, verifies codesigning, registers the embedded
extension with:

```sh
pluginkit -a /Applications/Mahjong3D.app/Contents/PlugIns/Mahjong3DScreenSaverExtension.appex
```

and restarts the relevant screen saver agents. Set `OPEN_SETTINGS=0` to skip
opening System Settings during scripted checks.

`pluginkit` caches extension locations aggressively and appears to prefer
`/Applications`. While testing, use one location consistently: either install to
`/Applications` with this script, or develop from Xcode build products without
also keeping a copy in `/Applications`.

## Package

```sh
make package-saver
```

The package target creates a DMG containing `Mahjong3D.app` and `README.txt`:

```text
macos/build/Mahjong3D.dmg
```

For a distributable release, sign and notarize it:

```sh
SIGN_IDENTITY="Developer ID Application: ..." \
NOTARY_PROFILE="notarytool-keychain-profile" \
make package-saver
```

## Legacy Fallback

The older `.saver` bundle is still buildable for pre-Sonoma systems or for
regression testing:

```sh
bash macos/scripts/build-saver.sh
make install-legacy-screensaver
make package-legacy-saver
```

The legacy artifact writes `macos/build/Mahjong3D.saver`, and the legacy DMG is:

```text
macos/build/Mahjong3D-legacy-saver.dmg
```

## Diagnostics

Host app and extension logs use the unified subsystem:

```text
io.github.elh.mahjong-3d.app
```

Stream them with:

```sh
log stream --predicate 'subsystem == "io.github.elh.mahjong-3d.app"' --level debug
```

Useful registration checks:

```sh
pluginkit -m -v -p com.apple.screensaver | grep io.github.elh.mahjong-3d.app.screensaver
codesign --verify --deep --strict macos/build/Mahjong3D.app
```

Diagnostic screen saver modes can be compiled into the extension with
`MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE`:

```sh
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE=native-layer make install-screensaver
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE=dom make install-screensaver
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE=canvas2d make install-screensaver
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE=webgl-static make install-screensaver
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE=app make install-screensaver
```

`native-layer` never creates a `WKWebView`; it renders a moving AppKit/CALayer
heartbeat directly in the extension view. The web modes keep the normal
`WKWebView` and native frame bridge but replace the Mahjong scene with DOM, 2D
canvas, or WebGL readback diagnostics. Each mode logs visible frame counters
through the unified subsystem.
