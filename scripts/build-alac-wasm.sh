#!/usr/bin/env bash
set -euo pipefail

mkdir -p public/wasm
clang --target=wasm32-unknown-unknown -std=c11 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--export=volta_alac_decode_packet \
  -Wl,--export=volta_alac_heap_base \
  -Wl,--initial-memory=4194304 \
  -Wl,--max-memory=268435456 \
  -Wl,--strip-all \
  -o public/wasm/volta-alac.wasm \
  src/wasm/volta_alac.c
