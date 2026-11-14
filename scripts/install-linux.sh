#!/usr/bin/env bash
set -euo pipefail

binary=${1:-}
if [[ ! -f "$binary" || ! -x "$binary" ]]; then
    printf 'Usage: %s /path/to/executable-gitscope\n' "$0" >&2
    exit 2
fi

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
data_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}
install_dir="$data_dir/gitscope-app"
menu_dir="$data_dir/applications"
launcher="$menu_dir/app.gitscope.desktop.desktop"

mkdir -p -- "$install_dir" "$menu_dir"
staging=$(mktemp -d "$install_dir/install.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT

install -m755 -- "$binary" "$staging/gitscope"
install -m644 -- "$project/src-tauri/icons/128x128.png" "$staging/icon.png"
cat > "$staging/launch" <<'LAUNCHER'
#!/bin/sh
set -eu
dir=$(dirname -- "$0")
exec "$dir/gitscope" "$@"
LAUNCHER
chmod 755 "$staging/launch"

# Quote the path according to the Desktop Entry Exec and string rules.
exec_path=$(python3 - "$install_dir/launch" <<'PY'
import sys

path = sys.argv[1]
if any(ord(char) < 32 for char in path):
    raise SystemExit('Installation path contains a control character.')
print('"' + ''.join({chr(92): chr(92) * 4, '"': chr(92) * 2 + '"',
                       '$': chr(92) * 2 + '$', chr(96): chr(92) * 2 + chr(96),
                       '%': '%%'}.get(char, char) for char in path) + '"')
PY
)
icon_path=$(printf '%s' "$install_dir/icon.png" | sed 's/\\/\\\\/g')
cat > "$staging/app.gitscope.desktop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=GitScope
Comment=Explore and track public GitHub repositories
Exec=$exec_path
Icon=$icon_path
Terminal=false
Categories=Development;
StartupWMClass=gitscope
DESKTOP
if command -v desktop-file-validate >/dev/null; then
    desktop-file-validate "$staging/app.gitscope.desktop.desktop"
fi

for file in gitscope icon.png launch; do
    mv -fT -- "$staging/$file" "$install_dir/$file"
done
mv -fT -- "$staging/app.gitscope.desktop.desktop" "$launcher"
if command -v update-desktop-database >/dev/null; then
    update-desktop-database "$menu_dir"
fi
printf '%s\n' "$launcher"
