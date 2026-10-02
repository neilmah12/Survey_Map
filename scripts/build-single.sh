#!/usr/bin/env bash
# Builds dist-single/index.html: the editor as one file that opens by double-click, including the
# client viewer template it uses to export client files.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .worker-build dist-client src/generated && mkdir -p src/generated
# 1. the map worker, as a standalone script
npx vite build --outDir .worker-build --emptyOutDir > /dev/null
cp .worker-build/assets/maplibre-gl-worker-*.js src/generated/maplibre-worker.js
# 2. the client viewer, checked for editor code, then embedded into the editor
npx vite build --config vite.client.config.ts > /dev/null
node scripts/check-client-bundle.mjs dist-client/client.html
node scripts/embed-template.mjs
# 3. the editor
npx vite build --config vite.single.config.ts
rm -rf .worker-build src/generated
