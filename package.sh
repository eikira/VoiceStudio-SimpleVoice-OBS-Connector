#!/bin/sh
# Builds two packages from one source:
#   dist/VoiceStudio-SimpleVoice-OBS-Connector-<version>-Chrome.zip   (manifest: background.service_worker only;
#       the folder inside is always called VoiceStudio-SimpleVoice-OBS-Connector, so an update keeps the same path)
#   dist/VoiceStudio-SimpleVoice-OBS-Connector-<version>-Firefox.zip  (manifest: background.scripts only; files at the
#       top of the zip: this is the file to upload to addons.mozilla.org)
# extension/ is the source and also the Chrome version (load it unpacked in Chrome for development).
# manifests/chrome.json and manifests/firefox.json differ only in "background" and in "browser_specific_settings" (Firefox only).
set -e
cd "$(dirname "$0")"
NAME=VoiceStudio-SimpleVoice-OBS-Connector
v=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' manifests/chrome.json | head -1)
vf=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' manifests/firefox.json | head -1)
[ "$v" = "$vf" ] || { echo "version differs between the manifests"; exit 1; }
cmp -s manifests/chrome.json extension/manifest.json || { echo "extension/manifest.json must equal manifests/chrome.json"; exit 1; }
mkdir -p dist
for b in chrome firefox; do
  B=$(echo "$b" | sed 's/^./\U&/')
  tmp=$(mktemp -d)
  if [ "$b" = chrome ]; then work="$tmp/$NAME"; else work="$tmp/files"; fi
  mkdir -p "$work"
  cp -a extension/. "$work/"
  cp manifests/$b.json "$work/manifest.json"
  out="$PWD/dist/$NAME-$v-$B.zip"
  rm -f "$out"
  if [ "$b" = chrome ]; then (cd "$tmp" && find "$NAME" -type f | LC_ALL=C sort | TZ=UTC zip -X -q "$out" -@)
  else (cd "$work" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | TZ=UTC zip -X -q "$out" -@); fi
  rm -rf "$tmp"
  echo "$out"
done
