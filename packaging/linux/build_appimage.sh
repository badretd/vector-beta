#!/usr/bin/env bash
# Build an AppImage from an existing PyInstaller onedir build.
#
# Usage:
#   packaging/linux/build_appimage.sh 0.1.0
#
# Requires `appimagetool` on PATH or set APPIMAGETOOL=/path/to/appimagetool.
set -euo pipefail

VERSION="${1:?usage: build_appimage.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPDIR="$ROOT/build/Vector.AppDir"
OUT="$ROOT/dist/Vector-${VERSION}-linux-${ARCH:-x86_64}.AppImage"
TOOL="${APPIMAGETOOL:-appimagetool}"

if [[ ! -x "$ROOT/dist/Vector/Vector" ]]; then
  echo "dist/Vector/Vector not found; run PyInstaller first." >&2
  exit 1
fi

rm -rf "$APPDIR"
mkdir -p \
  "$APPDIR/usr/bin" \
  "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp -a "$ROOT/dist/Vector" "$APPDIR/usr/bin/Vector"
install -m 0755 "$ROOT/packaging/linux/AppRun" "$APPDIR/AppRun"
install -m 0644 "$ROOT/packaging/linux/vector.desktop" "$APPDIR/vector.desktop"
install -m 0644 "$ROOT/packaging/linux/vector.desktop" \
  "$APPDIR/usr/share/applications/vector.desktop"
install -m 0644 "$ROOT/packaging/icons/vector-256.png" "$APPDIR/vector.png"
install -m 0644 "$ROOT/packaging/icons/vector-256.png" \
  "$APPDIR/usr/share/icons/hicolor/256x256/apps/vector.png"

export ARCH="${ARCH:-x86_64}"
# appimagetool is itself an AppImage; this lets it run on CI images without FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1

"$TOOL" --no-appstream "$APPDIR" "$OUT"
echo "Wrote $OUT"
