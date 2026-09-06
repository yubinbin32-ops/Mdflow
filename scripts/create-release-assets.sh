#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "JSON.parse(require('fs').readFileSync('$repo_root/package.json', 'utf8')).version")
app_root="$repo_root/dist/mdflow.app"
asset_root="$repo_root/dist/release"
archive="$asset_root/mdflow-$version-macos.zip"
manifest="$asset_root/mdflow-$version-release-manifest.json"
checksums="$asset_root/SHA256SUMS"

if ! command -v ditto >/dev/null 2>&1; then
  echo "ditto is required to create a macOS app archive" >&2
  exit 2
fi

npm --prefix "$repo_root" run release:verify
if [ ! -d "$app_root" ]; then
  echo "Missing verified app bundle: $app_root" >&2
  exit 2
fi

rm -rf "$asset_root"
mkdir -p "$asset_root"
ditto -c -k --sequesterRsrc --keepParent "$app_root" "$archive"
cp "$app_root/Contents/Resources/RELEASE-MANIFEST.json" "$manifest"

(cd "$asset_root" && shasum -a 256 "$(basename "$archive")" "$(basename "$manifest")" > "$(basename "$checksums")")
printf '%s\n' "$asset_root"
