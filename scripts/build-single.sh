#!/usr/bin/env bash
# Build dist-single/index.html: a single file that opens by double-click.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .worker-build src/generated && mkdir -p src/generated
npx vite build --outDir .worker-build --emptyOutDir > /dev/null
cp .worker-build/assets/maplibre-gl-worker-*.js src/generated/maplibre-worker.js
npx vite build --config vite.single.config.ts
rm -rf .worker-build src/generated
