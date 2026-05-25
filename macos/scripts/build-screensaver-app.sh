#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
WEB_DIST="$ROOT_DIR/dist-screensaver"
PROJECT="$MACOS_DIR/Mahjong3D.xcodeproj"
DERIVED_DATA="$BUILD_DIR/xcode-derived"
PRODUCTS_DIR="$BUILD_DIR/xcode-products"
CONFIGURATION="${CONFIGURATION:-Release}"
APP_BUNDLE="$BUILD_DIR/Mahjong3D.app"
BUILT_APP="$PRODUCTS_DIR/$CONFIGURATION/Mahjong3D.app"
APPEX_BUNDLE="$APP_BUNDLE/Contents/PlugIns/Mahjong3DScreenSaverExtension.appex"
ASSET_BUILD_DIR="$BUILD_DIR/assets"
NATIVE_RESOURCE_DIR="$MACOS_DIR/Mahjong3D/Resources"
EXTENSION_DIR="$MACOS_DIR/Mahjong3DScreenSaverExtension"
DIAGNOSTIC_MODE="${MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE:-app}"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/module-cache"

case "$DIAGNOSTIC_MODE" in
  app|native-layer|dom|canvas2d|webgl-static) ;;
  *)
    echo "Unsupported MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE: $DIAGNOSTIC_MODE" >&2
    echo "Expected one of: app, native-layer, dom, canvas2d, webgl-static" >&2
    exit 1
    ;;
esac

cd "$ROOT_DIR"
bun run build:screensaver

rm -rf "$ASSET_BUILD_DIR" "$DERIVED_DATA" "$PRODUCTS_DIR" "$APP_BUNDLE" "$CLANG_MODULE_CACHE_PATH"
mkdir -p "$ASSET_BUILD_DIR" "$PRODUCTS_DIR" "$CLANG_MODULE_CACHE_PATH"
xcrun swift "$MACOS_DIR/scripts/generate-dmg-assets.swift" "$ROOT_DIR" "$ASSET_BUILD_DIR"

xcodebuild \
  -project "$PROJECT" \
  -scheme Mahjong3D \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA" \
  CONFIGURATION_BUILD_DIR="$PRODUCTS_DIR/$CONFIGURATION" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [ ! -d "$BUILT_APP" ]; then
  echo "Expected Xcode build product not found: $BUILT_APP" >&2
  exit 1
fi

ditto "$BUILT_APP" "$APP_BUNDLE"

mkdir -p \
  "$APP_BUNDLE/Contents/Resources" \
  "$APPEX_BUNDLE/Contents/Resources/Web"

cp "$NATIVE_RESOURCE_DIR/Mahjong3D.icns" "$APP_BUNDLE/Contents/Resources/Mahjong3D.icns"
cp "$ASSET_BUILD_DIR/thumbnail.png" "$APPEX_BUNDLE/Contents/Resources/thumbnail.png"
cp "$ASSET_BUILD_DIR/thumbnail@2x.png" "$APPEX_BUNDLE/Contents/Resources/thumbnail@2x.png"
cp "$ASSET_BUILD_DIR/thumbnail.png" "$APP_BUNDLE/Contents/Resources/thumbnail.png"
cp "$ASSET_BUILD_DIR/thumbnail@2x.png" "$APP_BUNDLE/Contents/Resources/thumbnail@2x.png"
rsync -a --delete "$WEB_DIST/" "$APPEX_BUNDLE/Contents/Resources/Web/"
printf "%s\n" "$DIAGNOSTIC_MODE" > "$APPEX_BUNDLE/Contents/Resources/DiagnosticMode.txt"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign \
    --force \
    --timestamp \
    --options runtime \
    --entitlements "$EXTENSION_DIR/Mahjong3DScreenSaverExtension.entitlements" \
    --sign "$SIGN_IDENTITY" \
    "$APPEX_BUNDLE"
  codesign \
    --force \
    --timestamp \
    --options runtime \
    --sign "$SIGN_IDENTITY" \
    "$APP_BUNDLE"
else
  codesign \
    --force \
    --entitlements "$EXTENSION_DIR/Mahjong3DScreenSaverExtension.entitlements" \
    --sign - \
    "$APPEX_BUNDLE"
  codesign \
    --force \
    --sign - \
    "$APP_BUNDLE"
fi

codesign --verify --deep --strict "$APP_BUNDLE"

echo "Built $APP_BUNDLE"
