#!/bin/bash
# The Home test page: copies the mocks into website/__mock and the page to website/__home.html, serves the site on 8765,
# screenshots desktop and phone into the folder given ($1), then cleans up.
set -e
ROOT=/home/user/ta; OUT=${1:-/tmp/hometest}; mkdir -p "$OUT"
rm -rf /home/user/ta/website/__mock; cp -r "$ROOT/tools/hometest/mock" /home/user/ta/website/__mock; cp "$ROOT/tools/hometest/page.html" /home/user/ta/website/__home.html; cp "$ROOT/tools/hometest/results.html" /home/user/ta/website/__results.html
(cd "$ROOT/website" && python3 -m http.server 8765 >/dev/null 2>&1 &) ; sleep 1
node "$ROOT/tools/hometest/${SHOT:-shot.js}" "$OUT" || true
pkill -f "http.server 8765" || true
rm -rf /home/user/ta/website/__mock; rm -f /home/user/ta/website/__home.html /home/user/ta/website/__results.html
