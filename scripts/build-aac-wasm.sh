#!/usr/bin/env bash
set -euo pipefail

mkdir -p public/wasm
clang --target=wasm32-unknown-unknown -std=c11 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--export=volta_aac_decode_frame \
  -Wl,--export=volta_aac_sample_rate \
  -Wl,--export=volta_aac_channels \
  -Wl,--export=volta_aac_heap_base \
  -Wl,--initial-memory=8388608 \
  -Wl,--max-memory=268435456 \
  -Wl,--strip-all \
  -o public/wasm/volta-aac.wasm \
  src/wasm/volta_aac.c
