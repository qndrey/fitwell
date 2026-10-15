# Body model

`body.glb.gz` (gzip of a GLB; the player unzips it with `DecompressionStream`) is the male body of the exercise animation: 13,380 vertices, 53 bones (the game-engine skeleton of MPFB),
skin weights, and per-vertex muscle weights in five attributes `_MUSCLE0` to `_MUSCLE4` (four muscles each, in the
order of `scripts/blender/muscle_regions.py`). It has no textures and no materials: the player draws it with its own.

## Where it comes from
Made with **MPFB** (MakeHuman for Blender, 2.0.18) from its **core assets** (base mesh, targets, the game-engine rig and
its weights). MPFB's own FAQ states that "All core assets (the base mesh, targets, skins…) are shared under CC0" and that
models can be sold and used in closed-source games. No third-party assets (clothes, hair, skins) are used.

## How it was made
1. `scripts/blender/make_body.py` creates the body (the "muscular" preset), rigs it, removes the helper geometry,
   computes the muscle weights (`scripts/blender/muscle_regions.py`) and exports a GLB:
   `/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_body.py -- <out> muscular`
2. The GLB is shrunk with glTF-Transform and gzipped. Meshopt is not used on purpose: its decoder is WebAssembly, which a
   host's content-security policy may refuse:
   `gltf-transform quantize in.glb q.glb --quantize-generic 8 --quantize-weight 8 --quantize-normal 10 --quantize-position 14`
   `gzip -9 -n -c q.glb > body.glb.gz`
   (1.84 MB to 343 KB.)
