# Makes the male body for the exercise animation with MPFB (MakeHuman for Blender), rigs it, and exports a GLB and a
# preview picture. Run headless:
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_body.py -- <out-dir>
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
out = args[0] if args else "/tmp"
preset = args[1] if len(args) > 1 else "muscular"
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.blender_org.mpfb")

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402

macro = TargetService.get_default_macro_info_dict()
PRESETS = {
    "lean": {"macro": {"gender": 1.0, "age": 0.5, "muscle": 0.8, "weight": 0.45, "proportions": 0.6, "height": 0.55}, "details": {}},
    # A strongly built, lean athlete: the muscle slider at its top, low body fat, and every muscle group pushed up.
    "muscular": {
        "macro": {"gender": 1.0, "age": 0.45, "muscle": 1.0, "weight": 0.38, "proportions": 0.65, "height": 0.55},
        "details": {
            "torso-muscle-pectoral-incr": 1.0,
            "torso-muscle-dorsi-incr": 1.0,
            "torso-vshape-incr": 0.9,
            "l-upperarm-shoulder-muscle-incr": 1.0,
            "r-upperarm-shoulder-muscle-incr": 1.0,
            "l-upperarm-muscle-incr": 1.0,
            "r-upperarm-muscle-incr": 1.0,
            "l-lowerarm-muscle-incr": 0.8,
            "r-lowerarm-muscle-incr": 0.8,
            "l-upperleg-muscle-incr": 1.0,
            "r-upperleg-muscle-incr": 1.0,
            "l-lowerleg-muscle-incr": 1.0,
            "r-lowerleg-muscle-incr": 1.0,
        },
    },
}
macro.update(PRESETS[preset]["macro"])
macro["race"] = {"asian": 0.1, "caucasian": 0.8, "african": 0.1}

basemesh = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
basemesh.name = "Body"

# Detail targets for single muscle groups.
for target_name, weight in PRESETS[preset]["details"].items():
    path = TargetService.target_full_path(target_name)
    if not path:
        print("NO TARGET", target_name)
        continue
    TargetService.load_target(basemesh, path, weight=weight, name=target_name)

# Bake the shape (the sliders are shape keys) into the mesh itself.
bpy.context.view_layer.objects.active = basemesh
basemesh.select_set(True)
bpy.ops.object.shape_key_remove(all=True, apply_mix=True)

# Rig first: the weights are stored by vertex number of the full base mesh, helper geometry included.
rig = HumanService.add_builtin_rig(basemesh, "game_engine", import_weights=True)

# Then drop the helper geometry (joint cubes and the like): only the skin of the body is wanted.
import bmesh  # noqa: E402

bm = bmesh.new()
bm.from_mesh(basemesh.data)
deform = bm.verts.layers.deform.active
helper_ids = {basemesh.vertex_groups[n].index for n in ("HelperGeometry", "JointCubes") if n in basemesh.vertex_groups}
doomed = [v for v in bm.verts if any(i in helper_ids for i in v[deform].keys())]
bmesh.ops.delete(bm, geom=doomed, context="VERTS")
bm.to_mesh(basemesh.data)
bm.free()
basemesh.data.update()
print("VERTS", len(basemesh.data.vertices), "BONES", len(rig.data.bones), "HEIGHT", max(v.co.z for v in basemesh.data.vertices) - min(v.co.z for v in basemesh.data.vertices))
print("BONE HEADS", {b.name: tuple(round(c, 3) for c in b.head_local) for b in rig.data.bones if not any(k in b.name for k in ("index", "middle", "ring", "pinky", "thumb"))})

# Muscle weights per vertex, packed four to an attribute (_MUSCLE0 .. _MUSCLE4), so the player can tint a muscle group.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import muscle_regions  # noqa: E402

weights = muscle_regions.compute(basemesh, rig)
count = len(muscle_regions.MUSCLES)
for k in range((count + 3) // 4):
    attr = basemesh.data.color_attributes.new(name=f"_MUSCLE{k}", type="FLOAT_COLOR", domain="POINT")
    for i, w in enumerate(weights):
        chunk = w[k * 4 : k * 4 + 4] + [0.0] * 4
        attr.data[i].color = tuple(chunk[:4])
with open(os.path.join(out, "muscles.json"), "w") as f:
    import json

    json.dump({"muscles": muscle_regions.MUSCLES}, f)

# Only what the player needs: no extra vertex groups (parts of the face, left/right) and no materials (the player has its own).
bone_names = {b.name for b in rig.data.bones}
for g in [g for g in basemesh.vertex_groups if g.name not in bone_names]:
    basemesh.vertex_groups.remove(g)
basemesh.data.materials.clear()
for name in [a.name for a in basemesh.data.attributes if a.name.startswith("MPFB") or a.name in ("Col", "color")]:
    pass

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"body-{preset}.blend"))
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
basemesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"body-{preset}.glb"), export_format="GLB", use_selection=True, export_skins=True, export_animations=False, export_apply=False, export_yup=True, export_attributes=True, export_all_influences=False, export_materials="NONE", export_vertex_color="NONE", export_texcoords=False)

# A preview render: front and side, flat grey, so the shape can be judged.
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = 700, 1000
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = (0.85, 0.7, 0.6)
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.1
for name, loc, rot in (("front", (0, -6, 0.9), (1.5708, 0, 0)), ("side", (6, 0, 0.9), (1.5708, 0, 1.5708)), ("angle", (4.2, -4.2, 1.5), (1.31, 0, 0.785))):
    cam.location = loc
    cam.rotation_euler = rot
    scene.render.filepath = os.path.join(out, f"preview-{preset}-{name}.png")
    bpy.ops.render.render(write_still=True)
print("DONE")
