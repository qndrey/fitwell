# Body model

`body.glb.gz` (gzip of a GLB; the player unzips it with `DecompressionStream`) is the male body of the exercise animation: 13,380 vertices, 59 bones (the game-engine skeleton of MPFB
plus six twist bones), skin weights, and the muscle map in one attribute `_MUSCLE`: each vertex's two strongest muscle parts
("heads"), each as its number and a weight. The model lists its heads and the muscle group of each (`fitwell_heads` in the
mesh's extras; the list is in `scripts/blender/muscle_regions.py`). It has no textures and no materials: the player draws it with its own.

## Where it comes from
Made with **MPFB** (MakeHuman for Blender, 2.0.18) from its **core assets** (base mesh, targets, the game-engine rig and
its weights). MPFB's own FAQ states that "All core assets (the base mesh, targets, skins…) are shared under CC0" and that
models can be sold and used in closed-source games. No third-party assets (clothes, hair, skins) are used.

## How it is made
`sh scripts/blender/build.sh` (from `apps/mcp`; needs Blender with the MPFB extension) does all of it:
1. `scripts/blender/make_body.py` makes the **reference** body, the one the muscle outlines of `muscle_regions.py` are drawn on
   (in metres), and writes its muscle map by vertex number (`muscle-map.json`).
2. It makes the shipped body (the "muscular" preset: the reference with a slightly larger head and thicker neck, forearms and
   wrists), rigs it, adds the twist bones (copies of the forearm, upper arm and thigh bones that carry part of their skin, so a
   limb turning about itself does not wring the skin at the joint), and takes the muscle map from the reference by vertex number:
   MPFB's base mesh has the same vertices in every body, so the shape can change without redrawing the outlines.
3. The GLB is shrunk with glTF-Transform and gzipped. Meshopt is not used on purpose: its decoder is WebAssembly, which a
   host's content-security policy may refuse:
   `gltf-transform quantize in.glb q.glb --quantize-generic 8 --quantize-weight 8 --quantize-normal 10 --quantize-position 14`
   `gzip -9 -n -c q.glb > body.glb.gz`
   (1.9 MB to 333 KB.)

Check a change with `npx tsx scripts/body-shots.ts` (pictures of the figure in fixed poses; the `heads-*` shots colour every
muscle part on its own).
