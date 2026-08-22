# Mahjong 3D macOS Screen Saver

This folder contains the native macOS wrappers for the Mahjong 3D web screen
saver build.

## Architecture

Only macOS 26 Tahoe is supported. Older deployment targets and the legacy saver
build remain available for development and regression testing, but they are not
supported release configurations.

The default artifact is `Mahjong3D.app`, a minimal SwiftUI container app with an
embedded `Mahjong3DScreenSaverExtension.appex`. The extension uses the
`com.apple.screensaver` app-extension point and hosts the local Vite screen saver
build in a `WKWebView` over the custom `mahjong3d-saver://` scheme.

This structure follows the approach documented by
[AerialScreensaver/AppexSaverMinimal](https://github.com/AerialScreensaver/AppexSaverMinimal):
an application bundle owns and registers a sandboxed `XPC!` screen saver
extension. Apple does not ship public headers for this screen saver extension
host, so this repo includes the small private `ScreenSaverExtension` and
`ScreenSaverViewController` declarations needed to compile against it. Those
declarations are adapted from that MIT-licensed sample.
Aerial's AppExtension screen saver notes were also consulted while choosing
this structure.

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
- The important Tahoe WKWebView workaround is that native code owns frame
  delivery. We found public reports of WKWebView screen savers disappearing or
  halting after a few seconds without a published fix; this implementation sets
  `SSENeedsAnimationTimer` to `false`, owns a main-run-loop timer,
  calls `window.mahjongScreenSaver.renderFrame(performance.now())` at 30 fps,
  and the web app advances its manual React Three Fiber frame loop from that
  event instead of relying on WebKit's own animation scheduling.
- Do not make screen saver visibility or playback depend on CSS animation or
  transition completion events. An inactive `WKWebView` can stall its normal
  animation/compositor scheduling even while the native frame bridge continues
  to advance Three.js. In particular, an opaque loading or round-transition
  layer that waits for `transitionend` can cover a correctly rendered scene
  forever and look like a WebGL failure. Scene fades therefore share one
  elapsed-time state machine: the web surface samples it with
  `requestAnimationFrame`, while the screen saver samples it from
  `mahjong-screen-saver-frame` timestamps. Once a reveal reaches zero opacity,
  the cover is removed from the DOM rather than left composited over the canvas.
- On macOS 14 and newer, the extension sets `WKPreferences.inactiveSchedulingPolicy`
  to `.none` as a best-effort guard against WebKit suspending an attached screen
  saver web view.
- The extension stays sandboxed and loads only bundled resources. Local
  app-extension testing showed WKWebView still needs the network-client
  entitlement for its WebKit networking process plumbing even when serving the
  custom local scheme.
- Startup and teardown are anchored to `viewDidMoveToWindow()` following the
  Aerial minimal sample. There are no independent overlay windows, process-exit
  watchdogs, duplicate renderer ownership systems, or WebGL mirror fallbacks in
  this implementation.
- The native bridge still writes `window.__mahjongScreenSaverNativeState` before
  calling `setActive`, `setPreview`, or `renderFrame`, so React can bootstrap
  from early native state.
- Worker-backed round generation is disabled in `surface=screensaver`; the web
  app uses the local-file-safe no-worker fallback.
- The container app is intentionally small. It only points users to Screen Saver
  Settings; install and extension registration are handled by scripts and System
  Settings. It does not embed a preview renderer.

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

## Uninstall

For a normal installed copy, quit System Settings if it is open, move
`/Applications/Mahjong3D.app` to Trash, and reopen System Settings. The embedded
screen saver extension lives inside the app bundle, so deleting the app removes
the installed screen saver resources.

For local development installs, prefer:

```sh
make uninstall-screensaver
```

The uninstall target unregisters the embedded extension when the app is still
present, removes `/Applications/Mahjong3D.app`, removes any legacy
`Mahjong3D.saver` copies, and restarts the relevant screen saver agents. If the
app bundle is deleted manually first, System Settings may briefly keep a stale
screen saver entry in its extension cache; reinstalling and then running the
uninstall target gives `pluginkit` a live extension path to unregister.

## Package

```sh
make package-saver
```

The package target uses `create-dmg` to create a DMG containing
`Mahjong3D.app` and an Applications folder shortcut:

```text
macos/build/Mahjong3D.dmg
```

Install `create-dmg` before packaging:

```sh
npm install --global create-dmg
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

Release builds are quiet by default. Debug builds log by default. For a local
Release build with logs, set `MAHJONG3D_SCREENSAVER_LOGGING=1` when building;
the build script stores that flag inside the app bundle. Enabled host app and
extension logs use the unified subsystem:

```text
io.github.elh.mahjong-3d.app
```

Stream them with:

```sh
log stream --predicate 'subsystem == "io.github.elh.mahjong-3d.app"' --level debug
```

For local installs with logging enabled:

```sh
env OPEN_SETTINGS=0 MAHJONG3D_SCREENSAVER_LOGGING=1 make install-screensaver
```

After changing startup readiness, fades, overlays, or frame scheduling, test the
installed extension in the actual full-screen `ScreenSaverEngine`. The small
System Settings preview and the normal browser do not reproduce all inactive
WKWebView scheduling behavior. Verify both the initial reveal and at least one
complete end-of-round cover, scene swap, and reveal before packaging a release.

Useful registration checks:

```sh
pluginkit -m -v -p com.apple.screensaver | grep io.github.elh.mahjong-3d.app.screensaver
codesign --verify --deep --strict macos/build/Mahjong3D.app
```
