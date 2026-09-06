#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "JSON.parse(require('fs').readFileSync('$repo_root/package.json', 'utf8')).version")
repo_name=${GITHUB_REPOSITORY:-}
release_tag=${MDFLOW_RELEASE_TAG:-"v$version"}

if [ -z "$repo_name" ]; then
  echo "GITHUB_REPOSITORY must be set to owner/repository before upload" >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required for release upload" >&2
  exit 2
fi

npm --prefix "$repo_root" run release:assets
manifest="$repo_root/dist/release/mdflow-$version-release-manifest.json"
signing_mode=$(node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(value.signingMode || "unknown")' "$manifest")
if [ "$signing_mode" = "adhoc" ]; then
  echo "Refusing public upload: the package is ad-hoc signed. Run release:notarize with Developer ID credentials first." >&2
  exit 2
fi

gh release create "$release_tag" \
  "$repo_root/dist/release/mdflow-$version-macos.zip" \
  "$manifest" \
  "$repo_root/dist/release/SHA256SUMS" \
  --repo "$repo_name" \
  --title "mdflow $release_tag — Architecture that stays visible" \
  --notes-file "$repo_root/docs/releases/v$version.md"
