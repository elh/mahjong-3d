#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_BUNDLE="$ROOT_DIR/macos/build/Mahjong3D.app"
APP_DEST="/Applications/Mahjong3D.app"
APPEX_DEST="$APP_DEST/Contents/PlugIns/Mahjong3DScreenSaverExtension.appex"
SYSTEM_LEGACY_DEST="/Library/Screen Savers/Mahjong3D.saver"
USER_LEGACY_DEST="$HOME/Library/Screen Savers/Mahjong3D.saver"

bash "$ROOT_DIR/macos/scripts/build-screensaver-app.sh"

shell_quote() {
  printf "%q" "$1"
}

apple_script_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

admin_command="set -e; "
admin_command+="rm -rf $(shell_quote "$APP_DEST") $(shell_quote "$SYSTEM_LEGACY_DEST") $(shell_quote "$USER_LEGACY_DEST"); "
admin_command+="cp -R $(shell_quote "$APP_BUNDLE") $(shell_quote "$APP_DEST"); "
admin_command+="/usr/bin/codesign --verify --deep --strict $(shell_quote "$APP_DEST"); "
admin_command+="/usr/bin/killall WallpaperAgent || true; "
admin_command+="/usr/bin/killall ScreenSaverEngine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine.legacyScreenSaver || true"

escaped_admin_command="$(printf "%s" "$admin_command" | apple_script_escape)"
osascript -e "do shell script \"$escaped_admin_command\" with administrator privileges"

/usr/bin/pluginkit -a "$APPEX_DEST"

registered=0
for attempt in 1 2 3 4 5; do
  if /usr/bin/pluginkit -m -v -p com.apple.screensaver | /usr/bin/grep -F "io.github.elh.mahjong-3d.app.screensaver" >/dev/null; then
    registered=1
    break
  fi
  sleep 1
done

if [ "$registered" -ne 1 ]; then
  echo "WARNING: pluginkit did not list io.github.elh.mahjong-3d.app.screensaver yet." >&2
  echo "The app was installed at $APP_DEST; check later with:" >&2
  echo "  pluginkit -m -v -p com.apple.screensaver | grep io.github.elh.mahjong-3d.app.screensaver" >&2
fi

if [ "${OPEN_SETTINGS:-1}" != "0" ]; then
  /usr/bin/open "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension"
fi

echo "Installed $APP_DEST"
