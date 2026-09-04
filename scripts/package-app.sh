#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_mode=${1:-debug}
app_root="$repo_root/dist/mdflow.app"
binary_path="$repo_root/apps/desktop/.build/$build_mode/mdflow-desktop"

if [ ! -x "$binary_path" ]; then
  echo "Missing executable: $binary_path" >&2
  exit 1
fi

mkdir -p "$app_root/Contents/MacOS" "$app_root/Contents/Resources"
cp "$binary_path" "$app_root/Contents/MacOS/mdflow-desktop"
cp "$repo_root/apps/desktop/Resources/Info.plist" "$app_root/Contents/Info.plist"
cp "$repo_root/apps/desktop/Resources/AppIcon.icns" "$app_root/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$app_root" >/dev/null
echo "$app_root"
