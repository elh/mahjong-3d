#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
BUNDLE="$BUILD_DIR/Mahjong3D.saver"
DMG_BUNDLE_NAME="Mahjong3D.saver"
DMG_STAGING="$BUILD_DIR/dmg-staging"
DMG="$BUILD_DIR/Mahjong3D.dmg"

if [ -n "${NOTARY_PROFILE:-}" ] && [ -z "${SIGN_IDENTITY:-}" ]; then
  echo "NOTARY_PROFILE requires SIGN_IDENTITY so the nested saver is rebuilt and signed for distribution." >&2
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to package the DMG." >&2
  exit 1
fi

bash "$MACOS_DIR/scripts/build-saver.sh"

rm -rf "$DMG_STAGING" "$DMG"
mkdir -p "$DMG_STAGING"
cp -R "$BUNDLE" "$DMG_STAGING/$DMG_BUNDLE_NAME"
cat >"$DMG_STAGING/README.txt" <<'EOF'
Mahjong 3D Screen Saver

Double-click Mahjong3D.saver to install it, then select Mahjong 3D in System Settings > Screen Saver.
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
