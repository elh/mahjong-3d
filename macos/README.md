# Mahjong 3D macOS Screen Saver

This folder contains the native macOS wrapper for the web screen saver build.

## Current Status

This is a working checkpoint for the native wrapper and local bundle build, but
it is not ready for public distribution yet.

On macOS Sequoia, the saver is selectable in System Settings and the small
System Settings thumbnail preview animates. Fullscreen preview currently reaches
the bundled web app and renders the dark scene background, but remains on the
`Loading...` overlay.

The current diagnostics show:

- the fullscreen `WKWebView` loads `mahjong3d-saver://app/index.html?surface=screensaver`;
- round generation completes without the module worker;
- tile face textures finish loading;
- the tiny preview receives `active=true`, enters `preview=true`, and advances
  events;
- the fullscreen instances are receiving `stopAnimation()` immediately around
  load and report `active=false`, so the scene never becomes ready.

Next investigation should focus on Sequoia's third-party `ScreenSaverView`
lifecycle and the recommended architecture for web-backed screen savers. The
most likely areas are `ScreenSaverEngine`/`legacyScreenSaver.appex` lifecycle
behavior, whether `WKWebView` rendering should be driven from a different native
entry point, and whether fullscreen screen savers need a different activation
contract than System Settings thumbnail previews.

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
