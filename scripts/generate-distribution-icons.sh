#!/usr/bin/env bash
# Regenerates the PWA and Microsoft Store (AppX) icon sets from the canonical
# runtime icon (public/ICON.png). Outputs are committed; rerun only after a
# reviewed change to the canonical icon (see docs/BRANDING.md).
# Requires ImageMagick 6/7 (`convert`).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=public/ICON.png
BG="#fdf1dd"
mkdir -p public/pwa build/appx

icon() { convert "$SRC" -filter Lanczos -resize "${2}x${2}" -strip "PNG32:$1"; }
padded() { # file size inner-percent background
  local inner=$(( $2 * $3 / 100 ))
  convert -size "${2}x${2}" "xc:$4" \( "$SRC" -filter Lanczos -resize "${inner}x${inner}" \) \
    -gravity center -composite -strip "PNG32:$1"
}
wide() { # file width height inner
  convert -size "${2}x${3}" "xc:$BG" \( "$SRC" -filter Lanczos -resize "${4}x${4}" \) \
    -gravity center -composite -strip "PNG32:$1"
}

icon public/pwa/icon-192.png 192
icon public/pwa/icon-512.png 512
padded public/pwa/icon-maskable-512.png 512 80 "$BG"
padded public/pwa/apple-touch-icon.png 180 88 "$BG"

icon build/appx/StoreLogo.png 50
icon build/appx/Square44x44Logo.png 44
icon build/appx/SmallTile.png 71
padded build/appx/Square150x150Logo.png 150 84 "$BG"
padded build/appx/LargeTile.png 310 84 "$BG"
wide build/appx/Wide310x150Logo.png 310 150 128
echo "Distribution icons regenerated."
