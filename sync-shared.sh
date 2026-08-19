#!/usr/bin/env bash
# Copies the files that the web portal and the browser extension share.
# The extension cannot load assets from the server, so it keeps its own copy;
# run this after editing any of these in public/ so the two never drift.
set -euo pipefail
cd "$(dirname "$0")"
cp public/css/theme.css      browser-extension/theme.css
cp public/css/parser.css     browser-extension/parser.css
cp public/js/motion.js       browser-extension/motion.js
cp public/js/parser-ui.js    browser-extension/parser-ui.js
echo "Synced theme.css, parser.css, motion.js, parser-ui.js -> browser-extension/"
