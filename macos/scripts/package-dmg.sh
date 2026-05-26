#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
APP_BUNDLE="$BUILD_DIR/Mahjong3D.app"
DMG_OUTPUT_DIR="$BUILD_DIR/dmg-output"
DMG="$BUILD_DIR/Mahjong3D.dmg"
CREATE_DMG_BIN="$(command -v create-dmg || true)"

if [ -n "${NOTARY_PROFILE:-}" ] && [ -z "${SIGN_IDENTITY:-}" ]; then
  echo "NOTARY_PROFILE requires SIGN_IDENTITY so the app is rebuilt and signed for distribution." >&2
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to package the DMG." >&2
  exit 1
fi

if [ -z "$CREATE_DMG_BIN" ]; then
  cat >&2 <<'EOF'
create-dmg is required to package the macOS release DMG.

Install it first, then run this command again:
  npm install --global create-dmg

See https://github.com/sindresorhus/create-dmg for details.
EOF
  exit 1
fi

CREATE_DMG_HELP="$("$CREATE_DMG_BIN" --help 2>&1 || true)"
if [[ "$CREATE_DMG_HELP" != *"create-dmg <app> [destination]"* ]]; then
  cat >&2 <<'EOF'
The create-dmg command on PATH is not the expected sindresorhus/create-dmg CLI.

Install the expected package, then run this command again:
  npm install --global create-dmg

See https://github.com/sindresorhus/create-dmg for details.
EOF
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

bash "$MACOS_DIR/scripts/build-screensaver-app.sh"

rm -rf "$DMG_OUTPUT_DIR" "$DMG"
mkdir -p "$DMG_OUTPUT_DIR"
"$CREATE_DMG_BIN" \
  --overwrite \
  --no-version-in-filename \
  --no-code-sign \
  --dmg-title "Mahjong 3D" \
  "$APP_BUNDLE" \
  "$DMG_OUTPUT_DIR"
GENERATED_DMG="$(find "$DMG_OUTPUT_DIR" -maxdepth 1 -type f -name "*.dmg" -print -quit)"
if [ -z "$GENERATED_DMG" ]; then
  echo "create-dmg completed, but no DMG was written to $DMG_OUTPUT_DIR." >&2
  exit 1
fi
mv "$GENERATED_DMG" "$DMG"

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
