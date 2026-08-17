# macOS Release

Release `Mahjong3D.app` with its embedded screen-saver extension, not the legacy
`.saver` bundle. For architecture and troubleshooting, see
[`macos/README.md`](../macos/README.md).

## 1. Bump the version

Keep these in sync:

- `package.json`
- `macos/Mahjong3D.xcodeproj/project.pbxproj` (`MARKETING_VERSION` and
  `CURRENT_PROJECT_VERSION`, for both targets)
- `macos/Mahjong3D/Info.plist` (legacy fallback)

Commit the version bump and run `make good`.

## 2. Confirm release credentials

The required signing identity is a **Developer ID Application** certificate:

```sh
security find-identity -v -p codesigning
```

Notarization uses a keychain profile created by the `notarytool`
`store-credentials` command. Confirm its name with whoever manages the Apple
credentials; do not commit credentials or private signing material.

## 3. Build, sign, and notarize

```sh
SIGN_IDENTITY='Developer ID Application: Eugene Leonard Huang (5FH8QG7A43)' \
NOTARY_PROFILE='<notarytool-keychain-profile>' \
make package-saver
```

The release artifact is `macos/build/Mahjong3D.dmg`.

The scripts intentionally build unsigned, add the web bundle and resources,
then sign inside-out: embedded `.appex`, containing `.app`, and DMG. The DMG is
then notarized and stapled. Do not modify any bundle after its signing step, and
do not publish an ad-hoc or merely signed-but-not-notarized build.

## 4. Verify before upload

```sh
codesign --verify --deep --strict --verbose=2 macos/build/Mahjong3D.app
codesign -dvvv macos/build/Mahjong3D.app
codesign -dvvv macos/build/Mahjong3D.dmg
xcrun stapler validate macos/build/Mahjong3D.dmg
shasum -a 256 macos/build/Mahjong3D.dmg
```

Check that the signatures name the expected Developer ID/team, the DMG reports
a stapled notarization ticket, and record the SHA-256 with the GitHub release.
