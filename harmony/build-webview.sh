#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"
RAW_DIST="$HERE/entry/src/main/resources/rawfile/dist"

cd "$APP_ROOT"
npm run build

rm -rf "$RAW_DIST"
mkdir -p "$(dirname "$RAW_DIST")"
cp -R "$APP_ROOT/dist" "$RAW_DIST"

find "$RAW_DIST" -name '._*' -delete
node - "$RAW_DIST" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const p = path.join(root, 'index.html');
let html = fs.readFileSync(p, 'utf8');
if (!html.includes('<base href="./"')) {
  html = html.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n    <base href="./" />');
}
// ArkWeb treats resource://rawfile module requests as opaque origins.
// Vite's crossorigin attributes turn those local assets into CORS failures.
html = html.replaceAll(' crossorigin', '');
html = html.replace(/<link\s+rel="manifest"[^>]*>/, '');
// ArkWeb also refuses external module scripts under resource://rawfile.
// Inline the entry bundle so the app starts without a local HTTP server.
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/, (_, src) => {
  const scriptPath = path.resolve(root, src.replace(/^\.\//, ''));
  return '<script type="module">\n' + fs.readFileSync(scriptPath, 'utf8') + '\n</script>';
});
fs.writeFileSync(p, html);
NODE

echo "Web bundle copied to $RAW_DIST"
