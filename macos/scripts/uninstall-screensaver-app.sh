#!/usr/bin/env bash
set -euo pipefail

APP_DEST="/Applications/Mahjong3D.app"
APPEX_DEST="$APP_DEST/Contents/PlugIns/Mahjong3DScreenSaverExtension.appex"
SYSTEM_LEGACY_DEST="/Library/Screen Savers/Mahjong3D.saver"
USER_LEGACY_DEST="$HOME/Library/Screen Savers/Mahjong3D.saver"

shell_quote() {
  printf "%q" "$1"
}

apple_script_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ -d "$APPEX_DEST" ]; then
  /usr/bin/pluginkit -r "$APPEX_DEST" || true
fi

admin_command="set -e; "
admin_command+="rm -rf $(shell_quote "$APP_DEST") $(shell_quote "$SYSTEM_LEGACY_DEST") $(shell_quote "$USER_LEGACY_DEST"); "
admin_command+="/usr/bin/killall WallpaperAgent || true; "
admin_command+="/usr/bin/killall ScreenSaverEngine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine.legacyScreenSaver || true"

escaped_admin_command="$(printf "%s" "$admin_command" | apple_script_escape)"
osascript -e "do shell script \"$escaped_admin_command\" with administrator privileges"

echo "Uninstalled Mahjong3D.app and Mahjong3D.saver installs."
