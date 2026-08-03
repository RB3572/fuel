#!/bin/bash
# Build, sign and (optionally) upload Health Logger to App Store Connect.
#
#   ./archive.sh          → produces a signed .ipa in build/
#   ./archive.sh upload   → same, then uploads it to App Store Connect
#
# Why this exists instead of just Product → Archive in Xcode:
#
# Automatic signing wants a *development* provisioning profile to sign the archive
# before re-signing it for distribution at export. Minting one requires the team to
# have at least one registered device, and this team has none — so Xcode's Archive
# action fails with "Your team has no devices from which to generate a provisioning
# profile", which surfaces in the UI as a bare "build failed".
#
# The way around it, which is also what CI systems do: archive without signing, attach
# the entitlements with an ad-hoc signature, then let the export step apply the real
# Apple Distribution identity. The ad-hoc step matters — export carries forward the
# entitlements it finds on the binary, so skipping it silently ships an app with no
# HealthKit entitlement, which builds and uploads fine and then reads nothing on device.
#
# Registering any device against the team would also fix it, and would let Product →
# Archive work normally again.

set -euo pipefail
cd "$(dirname "$0")"

TEAM=9VVDB6UALA
BUILD=$PWD/build
ARCHIVE=$BUILD/HealthLogger.xcarchive
DESTINATION=${1:-export}   # "export" or "upload"

command -v xcodegen >/dev/null || { echo "xcodegen not installed: brew install xcodegen"; exit 1; }
xcodegen generate

rm -rf "$BUILD"
mkdir -p "$BUILD"

echo "==> Archiving (unsigned)"
xcodebuild -project HealthLogger.xcodeproj -scheme HealthLogger \
  -destination 'generic/platform=iOS' -configuration Release \
  -archivePath "$ARCHIVE" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  archive

echo "==> Attaching entitlements"
codesign --force --sign - --entitlements Resources/HealthLogger.entitlements \
  "$ARCHIVE/Products/Applications/HealthLogger.app"

cat > "$BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "==> Exporting (destination: $DESTINATION)"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" \
  -exportPath "$BUILD/out" -allowProvisioningUpdates

if [ "$DESTINATION" = "export" ]; then
  APP=$BUILD/check/Payload/HealthLogger.app
  mkdir -p "$BUILD/check" && (cd "$BUILD/check" && unzip -oq "$BUILD/out/HealthLogger.ipa")
  echo "==> Verifying the signed app"
  codesign -dv --verbose=2 "$APP" 2>&1 | grep -E 'Authority=Apple Dist|TeamIdentifier'
  # A build without these is inert on device, so fail loudly rather than ship it.
  codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q healthkit \
    || { echo "FAIL: HealthKit entitlement missing from the signed app"; exit 1; }
  echo "OK: HealthKit entitlements present"
  echo "ipa: $BUILD/out/HealthLogger.ipa"
fi
