# Makes the male body for the exercise animation with MPFB (MakeHuman for Blender), rigs it, and exports a GLB and a
# preview picture. Run headless:
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_body.py -- <out-dir>
import json
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
    # A strongly built, lean athlete: the muscle slider at its top, low body fat, and every muscle group pushed up. The V-shape and
    # lats are kept moderate: at full strength the back and shoulders looked too wide for the rest of the body.
    "muscular": {
        "macro": {"gender": 1.0, "age": 0.45, "muscle": 1.0, "weight": 0.38, "proportions": 0.65, "height": 0.55},
        "details": {
            "torso-muscle-pectoral-incr": 1.0,
            "torso-muscle-dorsi-incr": 0.5,
            "torso-vshape-incr": 0.3,
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
# The body the muscle outlines of muscle_regions.py were drawn on (they are in metres on this body). The shipped body takes its
# muscle map from it by vertex number (MUSCLE_MAP, see build.sh), so its shape can change without redrawing the outlines.
PRESETS["reference"] = {"macro": dict(PRESETS["muscular"]["macro"]), "details": dict(PRESETS["muscular"]["details"])}
# The shipped body: the head a little larger and the neck, forearms and wrists a little thicker than MPFB's "ideal" proportions,
# which read as a small head on thin forearms next to the muscular trunk.
PRESETS["muscular"]["details"].update({
    "head-scale-horiz-incr": 0.5,
    "head-scale-depth-incr": 0.45,
    "head-scale-vert-incr": 0.35,
    "measure-neck-circ-incr": 0.35,
    "l-lowerarm-muscle-incr": 1.0,
    "r-lowerarm-muscle-incr": 1.0,
    "l-lowerarm-scale-horiz-incr": 0.35,
    "r-lowerarm-scale-horiz-incr": 0.35,
    "l-lowerarm-scale-depth-incr": 0.35,
    "r-lowerarm-scale-depth-incr": 0.35,
    "measure-wrist-circ-incr": 0.5,
})
# BODY_TWEAK='{"details": {"torso-vshape-incr": 0.3}, "macro": {"muscle": 0.9}}' tries changes to a preset without editing it.
tweak = json.loads(os.environ.get("BODY_TWEAK", "{}"))
PRESETS[preset]["details"].update(tweak.get("details", {}))
PRESETS[preset]["macro"].update(tweak.get("macro", {}))
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

# Twist bones. A limb's bone turns about itself as one piece, which wrings the skin at the joint next to it. Each twist bone is a
# copy of a limb bone, a child of it, that carries part of the skin: the far end of the forearm (it turns with the hand while the
# elbow stays), and the near end of the upper arm and of the thigh (they stay with the shoulder and the hip while the rest turns
# with the elbow and the knee). The player poses them (ui/shared/humanBody.ts).
def add_twist(parent_name, far_end):
    name = parent_name.replace("_l", "_twist_l").replace("_r", "_twist_r")
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    parent = rig.data.edit_bones[parent_name]
    twist = rig.data.edit_bones.new(name)
    twist.head, twist.tail, twist.roll = parent.head.copy(), parent.tail.copy(), parent.roll
    twist.parent = parent
    twist.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    bone = rig.data.bones[parent_name]
    head = rig.matrix_world @ bone.head_local
    child = next(c for c in bone.children if not c.name.startswith(parent_name.split("_")[0] + "_twist"))
    axis = rig.matrix_world @ child.head_local - head
    length = axis.length
    axis = axis / length
    source = basemesh.vertex_groups[parent_name]
    target = basemesh.vertex_groups.new(name=name)
    for v in basemesh.data.vertices:
        w = next((g.weight for g in v.groups if g.group == source.index), 0.0)
        if w <= 0.0:
            continue
        t = (basemesh.matrix_world @ v.co - head).dot(axis) / length
        ramp = lambda a, b: max(0.0, min(1.0, (t - a) / (b - a)))  # noqa: E731
        part = ramp(0.15, 0.95) if far_end else 1.0 - ramp(0.1, 0.75)
        part = part * part * (3 - 2 * part)
        source.add([v.index], w * (1 - part), "REPLACE")
        target.add([v.index], w * part, "REPLACE")


for side in ("l", "r"):
    add_twist(f"lowerarm_{side}", True)
    add_twist(f"upperarm_{side}", False)
    add_twist(f"thigh_{side}", False)

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
# MUSCLE_MAP=<file> reads the weights by vertex number instead (the base mesh has the same vertices in every body MPFB makes, so a
# map made on one body fits another); the map of this run is written next to the model either way.
map_file = os.environ.get("MUSCLE_MAP")
if map_file:
    with open(map_file) as f:
        packed = [tuple(v) for v in json.load(f)["vertices"]]
    assert len(packed) == len(basemesh.data.vertices), "the muscle map is for another mesh"
else:
    packed = muscle_regions.pack(weights)
attr = basemesh.data.color_attributes.new(name="_MUSCLE", type="FLOAT_COLOR", domain="POINT")
for i, (a, wa, b, wb) in enumerate(packed):
    attr.data[i].color = ((a + 0.5) / muscle_regions.SLOTS, wa, (b + 0.5) / muscle_regions.SLOTS, wb)
# The player reads the heads and their muscle groups from the model itself.
basemesh["fitwell_heads"] = json.dumps([{"name": n, "group": g} for n, g in muscle_regions.HEADS])
with open(os.path.join(out, "muscle-map.json"), "w") as f:
    json.dump({"heads": [n for n, _ in muscle_regions.HEADS], "vertices": [[a, round(wa, 3), b, round(wb, 3)] for a, wa, b, wb in packed]}, f)

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
bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"body-{preset}.glb"), export_format="GLB", use_selection=True, export_skins=True, export_animations=False, export_apply=False, export_yup=True, export_attributes=True, export_extras=True, export_all_influences=False, export_materials="NONE", export_vertex_color="NONE", export_texcoords=False)

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
for name, loc, rot in (("front", (0, -6, 0.9), (1.5708, 0, 0)), ("side", (6, 0, 0.9), (1.5708, 0, 1.5708)), ("angle", (4.2, -4.2, 1.5), (1.31, 0, 0.785)), ("back", (0, 6, 0.9), (1.5708, 0, 3.1416))):
    cam.location = loc
    cam.rotation_euler = rot
    scene.render.filepath = os.path.join(out, f"preview-{preset}-{name}.png")
    bpy.ops.render.render(write_still=True)

print("DONE")
