#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
APP_BUNDLE="$BUILD_DIR/Mahjong3D.app"
DMG_BUNDLE_NAME="Mahjong3D.app"
DMG_STAGING="$BUILD_DIR/dmg-staging"
DMG="$BUILD_DIR/Mahjong3D.dmg"

if [ -n "${NOTARY_PROFILE:-}" ] && [ -z "${SIGN_IDENTITY:-}" ]; then
  echo "NOTARY_PROFILE requires SIGN_IDENTITY so the app is rebuilt and signed for distribution." >&2
  exit 1
fi

if [ -n "${SIGN_IDENTITY:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
  echo "Packaging public release DMG with Developer ID signing and notarization."
elif [ -n "${SIGN_IDENTITY:-}" ]; then
  echo "WARNING: SIGN_IDENTITY is set but NOTARY_PROFILE is missing." >&2
  echo "This DMG will be signed but not notarized; do not upload it to a public release." >&2
else
  echo "WARNING: Packaging local/test DMG with ad-hoc signing only." >&2
  echo "Set SIGN_IDENTITY and NOTARY_PROFILE before uploading to a public release." >&2
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to package the DMG." >&2
  exit 1
fi

bash "$MACOS_DIR/scripts/build-screensaver-app.sh"

rm -rf "$DMG_STAGING" "$DMG"
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/$DMG_BUNDLE_NAME"
cat >"$DMG_STAGING/README.txt" <<'EOF'
Mahjong 3D Screen Saver

Move Mahjong3D.app to /Applications, then select Mahjong 3D in System Settings > Screen Saver.
If it does not appear immediately, run the pluginkit registration command documented in macos/README.md.
EOF

hdiutil create \
  -volname "Mahjong 3D" \
  -srcfolder "$DMG_STAGING" \
  -ov \
  -format UDZO \
  "$DMG"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign \
    --force \
    --timestamp \
    --options runtime \
    --sign "$SIGN_IDENTITY" \
    "$DMG"
fi

if [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$DMG" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
fi

echo "Packaged $DMG"
