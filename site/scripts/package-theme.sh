#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^Version:[[:space:]]*//p' "$root/wp-content/themes/clinicaexemplo/style.css" | head -n 1)"
[ -n "$version" ] || { echo "Theme version not found" >&2; exit 1; }
mkdir -p "$root/dist"
cd "$root/wp-content/themes"
zip -qr "$root/dist/clinicaexemplo-theme-$version.zip" clinicaexemplo -x '*/.DS_Store' '*/node_modules/*' '*/tests/*'
unzip -t "$root/dist/clinicaexemplo-theme-$version.zip"
