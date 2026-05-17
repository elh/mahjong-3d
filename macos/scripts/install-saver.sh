#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="$ROOT_DIR/macos/build/Mahjong3D.saver"
SYSTEM_DEST="/Library/Screen Savers/Mahjong3D.saver"
USER_DEST="$HOME/Library/Screen Savers/Mahjong3D.saver"

bash "$ROOT_DIR/macos/scripts/build-saver.sh"

shell_quote() {
  printf "%q" "$1"
}

apple_script_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

system_dest_dir="$(dirname "$SYSTEM_DEST")"
admin_command="set -e; "
admin_command+="rm -rf $(shell_quote "$SYSTEM_DEST") $(shell_quote "$USER_DEST"); "
admin_command+="mkdir -p $(shell_quote "$system_dest_dir"); "
admin_command+="cp -R $(shell_quote "$BUNDLE") $(shell_quote "$SYSTEM_DEST"); "
admin_command+="/usr/bin/codesign --verify --deep --strict $(shell_quote "$SYSTEM_DEST"); "
admin_command+="/usr/bin/killall WallpaperAgent || true; "
admin_command+="/usr/bin/killall ScreenSaverEngine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine || true; "
admin_command+="/usr/bin/killall ScreenSaver.Engine.legacyScreenSaver || true"

escaped_admin_command="$(printf "%s" "$admin_command" | apple_script_escape)"

osascript -e "do shell script \"$escaped_admin_command\" with administrator privileges"

echo "Installed $SYSTEM_DEST"
