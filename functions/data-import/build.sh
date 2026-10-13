#!/bin/sh
# Bundles src.js with the portal's shared code (js/data.js, js/sg.js, js/fieldDetail.js) into index.js,
# the one file to deploy. Run after changing any of them:  sh functions/data-import/build.sh
cd "$(dirname "$0")" && esbuild src.js --bundle --platform=node --target=node22 --format=esm \
  --external:@google-cloud/* --external:hyparquet --external:hyparquet-compressors \
  --banner:js="// Built from src.js by build.sh - edit src.js (and the portal's js/), not this file." --outfile=index.js
