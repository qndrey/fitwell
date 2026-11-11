#!/bin/sh
# Builds ui/assets/body.glb.gz: makes the body in Blender (MPFB), shrinks the GLB and gzips it. Run from apps/mcp:
#   sh scripts/blender/build.sh [out-dir] [preset]
# Meshopt is not used on purpose: its decoder is WebAssembly, which a host's content-security policy may refuse.
set -e
OUT="${1:-.wrangler/body}"
PRESET="${2:-muscular}"
mkdir -p "$OUT"
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
# The muscle map is drawn on the reference body and carried to the shipped one by vertex number.
"$BLENDER" --background --python scripts/blender/make_body.py -- "$OUT/reference" reference | grep -E "NO TARGET|Error|Traceback" || true
test -f "$OUT/reference/muscle-map.json"
MUSCLE_MAP="$OUT/reference/muscle-map.json" "$BLENDER" --background --python scripts/blender/make_body.py -- "$OUT" "$PRESET" | grep -E "VERTS|NO TARGET|Error|Traceback|DONE" || true
test -f "$OUT/body-$PRESET.glb"
npx gltf-transform quantize "$OUT/body-$PRESET.glb" "$OUT/q.glb" --quantize-generic 8 --quantize-weight 8 --quantize-normal 10 --quantize-position 14 > /dev/null
gzip -9 -n -c "$OUT/q.glb" > ui/assets/body.glb.gz
ls -l ui/assets/body.glb.gz
