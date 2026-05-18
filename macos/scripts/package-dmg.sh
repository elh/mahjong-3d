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

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "create-dmg is required to package the styled DMG. Install it with: brew install create-dmg" >&2
  exit 1
fi

bash "$MACOS_DIR/scripts/build-saver.sh"

rm -rf "$DMG_STAGING" "$DMG"
mkdir -p "$DMG_STAGING"
cp -R "$BUNDLE" "$DMG_STAGING/$DMG_BUNDLE_NAME"

create-dmg \
  --volname "Mahjong 3D" \
  --background "$BUILD_DIR/assets/dmg-background.png" \
  --window-size 720 420 \
  --text-size 10 \
  --icon-size 88 \
  --icon "$DMG_BUNDLE_NAME" 552 257 \
  --hide-extension "$DMG_BUNDLE_NAME" \
  --no-internet-enable \
  "$DMG" \
  "$DMG_STAGING"

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
