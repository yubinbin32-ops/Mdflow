#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
app_root=${1:-"$repo_root/dist/mdflow.app"}
notary_profile=${MDFLOW_NOTARY_PROFILE:-}
signing_identity=${MDFLOW_CODESIGN_IDENTITY:-}

if [ -z "$notary_profile" ]; then
  echo "MDFLOW_NOTARY_PROFILE must name an xcrun notarytool keychain profile" >&2
  exit 2
fi
if [ -z "$signing_identity" ] || [ "$signing_identity" = "-" ]; then
  echo "MDFLOW_CODESIGN_IDENTITY must be a Developer ID Application identity" >&2
  exit 2
fi
if [ ! -d "$app_root" ]; then
  echo "Missing app bundle: $app_root" >&2
  exit 2
fi

codesign --verify --deep --strict "$app_root"
xcrun notarytool submit "$app_root" --keychain-profile "$notary_profile" --wait
xcrun stapler staple "$app_root"
spctl --assess --type execute --verbose "$app_root"
echo "Notarized and stapled: $app_root"
