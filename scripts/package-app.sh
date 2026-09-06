#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_mode=${1:-debug}
app_root="$repo_root/dist/mdflow.app"
binary_path="$repo_root/apps/desktop/.build/$build_mode/mdflow-desktop"
signing_identity=${MDFLOW_CODESIGN_IDENTITY:--}

if [ ! -x "$binary_path" ]; then
  echo "Missing executable: $binary_path" >&2
  exit 1
fi

mkdir -p "$app_root/Contents/MacOS" "$app_root/Contents/Resources"
cp "$binary_path" "$app_root/Contents/MacOS/mdflow-desktop"
cp "$repo_root/apps/desktop/Resources/Info.plist" "$app_root/Contents/Info.plist"
cp "$repo_root/apps/desktop/Resources/AppIcon.icns" "$app_root/Contents/Resources/AppIcon.icns"
rm -f "$app_root/Contents/Resources/RELEASE-MANIFEST.json"
marketplace_root="$app_root/Contents/Resources/MarketplaceRoot"
mkdir -p "$marketplace_root/.agents/plugins" "$marketplace_root/plugins"
rm -rf "$marketplace_root/plugins/mdflow"
rsync -a --exclude '.DS_Store' --exclude '.gitkeep' "$repo_root/plugins/mdflow/" "$marketplace_root/plugins/mdflow/"
cp "$repo_root/.agents/plugins/marketplace.json" "$marketplace_root/.agents/plugins/marketplace.json"
if [ "$signing_identity" = "-" ]; then
  codesign --force --sign - "$app_root" >/dev/null
else
  codesign --force --options runtime --timestamp --sign "$signing_identity" "$app_root" >/dev/null
fi
echo "$app_root"
