#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
NATIVE_DIR="$MACOS_DIR/Mahjong3D"
WEB_DIST="$ROOT_DIR/dist-screensaver"
BUNDLE="$BUILD_DIR/Mahjong3D.saver"
EXECUTABLE="$BUNDLE/Contents/MacOS/Mahjong3D"
ASSET_BUILD_DIR="$BUILD_DIR/assets"
ASSET_CATALOG_DIR="$BUILD_DIR/LegacyScreenSaverAssets.xcassets"
ARCHS="${ARCHS:-arm64 x86_64}"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/module-cache"

cd "$ROOT_DIR"
bun run build:screensaver

rm -rf "$ASSET_BUILD_DIR" "$ASSET_CATALOG_DIR"
mkdir -p "$ASSET_BUILD_DIR" "$ASSET_CATALOG_DIR/thumbnail.imageset" "$CLANG_MODULE_CACHE_PATH"
xcrun swift "$MACOS_DIR/scripts/generate-dmg-assets.swift" "$ROOT_DIR" "$ASSET_BUILD_DIR"
cp "$ASSET_BUILD_DIR/thumbnail-assets.png" "$ASSET_CATALOG_DIR/thumbnail.imageset/thumbnail.png"
cp "$ASSET_BUILD_DIR/thumbnail-assets@2x.png" "$ASSET_CATALOG_DIR/thumbnail.imageset/thumbnail@2x.png"
cat > "$ASSET_CATALOG_DIR/thumbnail.imageset/Contents.json" <<'JSON'
{
  "images": [
    {
      "filename": "thumbnail.png",
      "idiom": "mac",
      "scale": "1x"
    },
    {
      "filename": "thumbnail@2x.png",
      "idiom": "mac",
      "scale": "2x"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
JSON

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources/Web"
cp "$NATIVE_DIR/Info.plist" "$BUNDLE/Contents/Info.plist"
cp "$ASSET_BUILD_DIR/screen-saver-icon.icns" "$BUNDLE/Contents/Resources/Mahjong3D.icns"
cp "$ASSET_BUILD_DIR/thumbnail.png" "$BUNDLE/Contents/Resources/thumbnail.png"
cp "$ASSET_BUILD_DIR/thumbnail@2x.png" "$BUNDLE/Contents/Resources/thumbnail@2x.png"
cp "$ASSET_BUILD_DIR/thumbnail.tiff" "$BUNDLE/Contents/Resources/thumbnail.tiff"
xcrun actool "$ASSET_CATALOG_DIR" \
  --compile "$BUNDLE/Contents/Resources" \
  --platform macosx \
  --minimum-deployment-target "$DEPLOYMENT_TARGET" \
  --output-format human-readable-text \
  >/dev/null
rsync -a --delete "$WEB_DIST/" "$BUNDLE/Contents/Resources/Web/"

arch_outputs=()
for arch in $ARCHS; do
  arch_dir="$BUILD_DIR/native/$arch"
  mkdir -p "$arch_dir"
  object="$arch_dir/Mahjong3D.o"
  output="$arch_dir/Mahjong3D"
  xcrun swiftc \
    -parse-as-library \
    -emit-object \
    -module-name Mahjong3D \
    -target "$arch-apple-macos$DEPLOYMENT_TARGET" \
    -framework AppKit \
    -framework ScreenSaver \
    -framework WebKit \
    "$NATIVE_DIR/Sources/Mahjong3DScreenSaver.swift" \
    -o "$object"
  xcrun swiftc \
    -target "$arch-apple-macos$DEPLOYMENT_TARGET" \
    "$object" \
    -framework AppKit \
    -framework ScreenSaver \
    -framework WebKit \
    -Xlinker -bundle \
    -o "$output"
  arch_outputs+=("$output")
done

if [ "${#arch_outputs[@]}" -eq 1 ]; then
  cp "${arch_outputs[0]}" "$EXECUTABLE"
else
  xcrun lipo -create "${arch_outputs[@]}" -output "$EXECUTABLE"
fi

chmod 755 "$EXECUTABLE"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign \
    --force \
    --timestamp \
    --options runtime \
    --sign "$SIGN_IDENTITY" \
    "$BUNDLE"
else
  codesign \
    --force \
    --sign - \
    "$BUNDLE"
fi

echo "Built $BUNDLE"
