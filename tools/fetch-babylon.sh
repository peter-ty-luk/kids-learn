#!/usr/bin/env bash
# Re-download the Babylon.js engine + glTF loaders into lib/ so the game runs
# with NO internet (LAN play). index.html references lib/babylon.js and
# lib/babylonjs.loaders.min.js. Run from the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p lib
echo "Fetching Babylon.js → lib/ …"
curl -fSL -o lib/babylon.js                 https://cdn.babylonjs.com/babylon.js
curl -fSL -o lib/babylonjs.loaders.min.js   https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js
grep -q BABYLON lib/babylon.js && grep -q BABYLON lib/babylonjs.loaders.min.js \
  && echo "OK: $(du -h lib/babylon.js lib/babylonjs.loaders.min.js | tr '\n' ' ')" \
  || { echo "ERROR: downloads do not look like Babylon"; exit 1; }
