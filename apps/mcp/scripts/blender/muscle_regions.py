# Assigns every vertex of the body a weight (0 to 1) for each muscle group of the exercise library, from where the
# vertex lies relative to the bones and which way its surface faces. The names are the library's own, so the player can
# tint "quadriceps" or "chest" for an exercise directly. Works on the rest pose (A-pose, facing -Y, Z up).
import math

import mathutils

MUSCLES = ["abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders", "traps", "triceps"]
# The parts ("heads") the body is divided into, each with the library's muscle group it belongs to. A vertex stores its two
# strongest heads, so the list can grow without the model carrying more data per vertex.
HEADS = [
    ("chest upper", "chest"), ("chest lower", "chest"),
    ("abs", "abdominals"), ("obliques", "abdominals"),
    ("neck", "neck"),
    ("traps", "traps"), ("rhomboids", "middle back"), ("lats", "lats"), ("erectors", "lower back"),
    ("glute max", "glutes"), ("glute med", "abductors"), ("tfl", "abductors"),
    ("delt front", "shoulders"), ("delt side", "shoulders"), ("delt rear", "shoulders"),
    ("biceps", "biceps"), ("triceps long", "triceps"), ("triceps lateral", "triceps"),
    ("forearm flexors", "forearms"), ("forearm extensors", "forearms"),
    ("rectus femoris", "quadriceps"), ("vastus lateralis", "quadriceps"), ("vastus medialis", "quadriceps"),
    ("adductors", "adductors"),
    ("hamstrings outer", "hamstrings"), ("hamstrings inner", "hamstrings"),
    ("calf inner", "calves"), ("calf outer", "calves"), ("soleus", "calves"),
]
INDEX = {name: i for i, (name, _) in enumerate(HEADS)}
assert {g for _, g in HEADS} == set(MUSCLES)
# A vertex keeps a head's number as (number + 0.5) / SLOTS, which survives the 8-bit storage of the shipped model.
SLOTS = 64


def pack(weights):
    """Per vertex, the two strongest heads as (head, weight, head, weight); together they weigh 1 at most."""
    out = []
    for w in weights:
        order = sorted(range(len(w)), key=lambda i: -w[i])
        a, b = order[0], order[1]
        wa, wb = w[a], w[b]
        total = wa + wb
        if total > 1.0:
            wa, wb = wa / total, wb / total
        if wb < 0.02:
            b, wb = (a + 1) % len(w), 0.0
        out.append((a, wa, b, wb))
    return out


def ss(a, b, x):
    """Smooth ramp from 0 at a to 1 at b (either direction)."""
    if a == b:
        return 1.0 if x >= a else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def band(lo0, lo1, hi0, hi1, x):
    """1 between lo1 and hi0, easing to 0 at lo0 and hi1."""
    return ss(lo0, lo1, x) * (1 - ss(hi0, hi1, x))


def poly(points, ax, z, soft):
    """Soft membership of the point (ax, z) in a polygon: 1 inside, 0 outside, a ramp of width 2 * soft across the edge.
    The polygons are drawn for one side of the body (ax is the distance from the midline); their middle edge lies past the midline,
    so the two sides join without a seam."""
    inside = False
    best = 1e9
    n = len(points)
    for i in range(n):
        (x1, z1), (x2, z2) = points[i], points[(i + 1) % n]
        if (z1 > z) != (z2 > z) and ax < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            inside = not inside
        dx, dz = x2 - x1, z2 - z1
        t = max(0.0, min(1.0, ((ax - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(ax - (x1 + t * dx), z - (z1 + t * dz)))
    return ss(-soft, soft, best if inside else -best)


def wrap(a):
    """An angle in degrees, brought to -180..180."""
    return (a + 180.0) % 360.0 - 180.0


# The model's vertices are one to two centimetres apart: an edge softer than that comes out smooth, a harder one follows the mesh.
SOFT = 0.022


def belly(t, angle, t0, t1, centre, half, length, radius, fat=0.35, thin=0.2):
    """A muscle belly on a limb: from t0 to t1 along the bone and `half` degrees to either side of the angle `centre` around it,
    narrowing toward its two ends as a muscle does toward its tendons (`fat` nearer 0 keeps it wide for longer; `thin` is how
    narrow it gets). `length` is the bone's and `radius` the vertex's distance from it, to make the edge as soft as SOFT."""
    soft_t = SOFT / length
    along = ss(t0 - soft_t, t0 + soft_t, t) * (1 - ss(t1 - soft_t, t1 + soft_t, t))
    if along <= 0.0:
        return 0.0
    u = max(0.0, min(1.0, (t - t0) / (t1 - t0)))
    width = half * max(thin, math.sin(math.pi * u) ** fat)
    soft_a = math.degrees(SOFT / max(radius, 0.03))
    return along * (1 - ss(width - soft_a, width + soft_a, abs(wrap(angle - centre))))


# The torso muscles as outlines (distance from the midline, height) on this body, in metres. Front: the chest fan and the straight
# abdominal muscle. Back: the trapezius' upper kite, the muscles between the shoulder blades, the erector columns, the glutes.
CHEST = [(-0.03, 1.4), (0.12, 1.405), (0.19, 1.355), (0.178, 1.285), (0.125, 1.24), (0.05, 1.218), (-0.03, 1.218)]
RECTUS = [(-0.03, 1.182), (0.055, 1.182), (0.085, 1.16), (0.092, 1.02), (0.062, 0.955), (0.02, 0.925), (-0.03, 0.925)]
TRAPS = [(-0.05, 1.53), (0.05, 1.52), (0.12, 1.465), (0.21, 1.41), (0.19, 1.378), (0.115, 1.385), (0.055, 1.335), (-0.05, 1.325)]
RHOMBOIDS = [(-0.05, 1.335), (0.05, 1.335), (0.105, 1.375), (0.12, 1.3), (0.085, 1.23), (0.03, 1.19), (-0.05, 1.18)]
ERECTORS = [(-0.01, 1.145), (0.06, 1.145), (0.072, 1.0), (0.055, 0.955), (-0.01, 0.955)]
GLUTE_MAX = [(-0.02, 0.975), (0.1, 0.985), (0.165, 0.945), (0.172, 0.87), (0.12, 0.815), (-0.02, 0.82)]
LATS_BACK = [(0.105, 1.17), (0.115, 1.24), (0.145, 1.315), (0.21, 1.315), (0.21, 1.15), (0.17, 1.03), (0.115, 0.99), (0.105, 1.03)]
# Around the trunk (degrees from straight ahead, height): the muscles that wrap the flank.
OBLIQUES = [(38, 1.19), (95, 1.2), (100, 1.0), (80, 0.965), (50, 0.98), (36, 1.02)]
LATS_SIDE = [(96, 1.3), (150, 1.305), (150, 0.99), (118, 1.07), (100, 1.19)]
GLUTE_MED = [(62, 1.0), (128, 1.005), (132, 0.93), (100, 0.9), (66, 0.93)]
# One degree around the trunk, in metres on its surface, so an outline's edge is as soft sideways as it is up and down.
ARC = math.radians(1.0) * 0.16


def girdle(points, around, z):
    return poly([(a * ARC, h) for a, h in points], around * ARC, z, SOFT)


def compute(mesh, rig):
    """Returns a list with, per vertex, a list of weights in HEADS order."""
    world = rig.matrix_world
    bones = {b.name: (world @ b.head_local, world @ b.tail_local) for b in rig.data.bones}
    mw = mesh.matrix_world
    groups = {g.index: g.name for g in mesh.vertex_groups}
    shoulder = {"l": bones["upperarm_l"][0], "r": bones["upperarm_r"][0]}

    def frame(bone, child):
        """A bone's line to the next joint, with the directions "front" and "outward" square to it."""
        head = bones[bone][0]
        axis = bones[child][0] - head
        length = axis.length
        axis = axis / length
        front = mathutils.Vector((0, -1, 0))
        front = (front - axis * front.dot(axis)).normalized()
        out = axis.cross(front)
        if out.x * (1 if bone.endswith("_l") else -1) < 0:
            out = -out
        return head, axis, length, front, out

    frames = {}
    for s in ("l", "r"):
        for bone, child in (("thigh", "calf"), ("calf", "foot"), ("upperarm", "lowerarm"), ("lowerarm", "hand")):
            frames[f"{bone}_{s}"] = frame(f"{bone}_{s}", f"{child}_{s}")
    out = []
    for v in mesh.data.vertices:
        p = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        front = ss(0.1, 0.55, max(0.0, -n.y))
        back = ss(0.1, 0.55, max(0.0, n.y))
        ax = abs(p.x)
        z = p.z
        w = [0.0] * len(HEADS)
        bw = {groups[g.group]: g.weight for g in v.groups if groups[g.group] in bones}
        side = "l" if p.x >= 0 else "r"
        # How much of the vertex belongs to these bones of its side (a bone's twist bone carries part of its skin).
        limb = lambda *names: min(1.0, 1.6 * sum(bw.get(f"{b}_{side}", 0.0) + bw.get(f"{b}_twist_{side}", 0.0) for b in names))  # noqa: E731
        core = min(1.0, 1.6 * (sum(bw.get(b, 0.0) for b in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01")) + bw.get(f"clavicle_{side}", 0.0)))
        trunk = core * (1.0 - limb("upperarm", "lowerarm"))
        hips = min(1.0, core + limb("thigh"))

        # ----- the trunk -----
        chest = front * poly(CHEST, ax, z, SOFT) * trunk
        # The upper part runs from the collarbone: above a line that rises from the breastbone toward the arm.
        upper = ss(-0.012, 0.012, z - (1.325 + 0.2 * ax))
        w[INDEX["chest upper"]] = chest * upper
        w[INDEX["chest lower"]] = chest * (1 - upper)
        w[INDEX["abs"]] = front * poly(RECTUS, ax, z, SOFT) * core
        around = math.degrees(math.atan2(ax, -p.y))  # 0 straight ahead, 90 at the side, 180 behind
        w[INDEX["obliques"]] = girdle(OBLIQUES, around, z) * trunk
        w[INDEX["lats"]] = max(back * poly(LATS_BACK, ax, z, SOFT), girdle(LATS_SIDE, around, z)) * trunk
        w[INDEX["traps"]] = max(back, ss(0.55, 0.9, n.z)) * poly(TRAPS, ax, z, SOFT) * trunk
        w[INDEX["rhomboids"]] = back * poly(RHOMBOIDS, ax, z, SOFT) * trunk
        w[INDEX["erectors"]] = back * poly(ERECTORS, ax, z, SOFT) * core
        w[INDEX["neck"]] = ss(0.35, 0.7, bw.get("neck_01", 0.0)) * (1 - back) * (1 - ss(1.56, 1.6, z))
        w[INDEX["glute max"]] = back * poly(GLUTE_MAX, ax, z, SOFT) * hips
        w[INDEX["glute med"]] = girdle(GLUTE_MED, around, z) * hips

        # ----- limbs: where along the bone, and at which angle around it (0 in front, 90 on the outside, 180 behind) -----
        def at(bone):
            head, axis, length, fwd, outward = frames[f"{bone}_{side}"]
            rel = p - head
            t = rel.dot(axis) / length
            radial = rel - axis * rel.dot(axis)
            return t, math.degrees(math.atan2(radial.dot(outward), radial.dot(fwd))), radial.length, length

        # The deltoid caps the shoulder and comes to a point a little under half-way down the upper arm.
        t, a, r, length = at("upperarm")
        if ax > 0.125 and (p - shoulder[side]).length < 0.2 and r < 0.1:
            cap = ss(-0.34, -0.2, t) * (1 - ss(0.4, 0.5, t)) * (1 - ss(0.085, 0.1, r))
            point = max(0.25, 1 - max(0.0, t - 0.1) / 0.36)  # narrower toward the point
            for name, centre, half in (("delt front", 12, 34), ("delt side", 80, 34), ("delt rear", 150, 36)):
                soft = math.degrees(SOFT / max(r, 0.03))
                w[INDEX[name]] = cap * (1 - ss(half * point - soft, half * point + soft, abs(wrap(a - centre))))
        arm = limb("upperarm", "lowerarm")
        if arm > 0.0:
            w[INDEX["biceps"]] = arm * belly(t, a, 0.26, 0.96, -22, 56, length, r)
            w[INDEX["triceps lateral"]] = arm * belly(t, a, 0.3, 0.9, 128, 38, length, r)
            w[INDEX["triceps long"]] = arm * belly(t, a, 0.14, 0.9, -146, 46, length, r)
            t, a, r, length = at("lowerarm")
            fore = limb("lowerarm", "hand")
            w[INDEX["forearm flexors"]] = fore * belly(t, a, -0.04, 0.8, -75, 78, length, r, fat=0.5, thin=0.45)
            w[INDEX["forearm extensors"]] = fore * belly(t, a, -0.04, 0.8, 105, 78, length, r, fat=0.5, thin=0.45)
        leg = limb("thigh", "calf")
        if leg > 0.0:
            t, a, r, length = at("thigh")
            w[INDEX["rectus femoris"]] = leg * belly(t, a, 0.06, 0.9, 4, 23, length, r)
            w[INDEX["vastus lateralis"]] = leg * belly(t, a, 0.16, 0.93, 56, 33, length, r)
            w[INDEX["vastus medialis"]] = leg * belly(t, a, 0.44, 0.96, -46, 28, length, r, fat=0.6)
            w[INDEX["adductors"]] = leg * belly(t, a, -0.02, 0.62, -84, 40, length, r, fat=0.25)
            w[INDEX["tfl"]] = leg * belly(t, a, -0.1, 0.3, 66, 26, length, r)
            w[INDEX["hamstrings outer"]] = leg * belly(t, a, 0.12, 0.93, 148, 31, length, r)
            w[INDEX["hamstrings inner"]] = leg * belly(t, a, 0.12, 0.93, -150, 31, length, r)
            t, a, r, length = at("calf")
            shank = limb("calf", "foot")
            w[INDEX["calf inner"]] = shank * belly(t, a, 0.03, 0.56, -152, 40, length, r, fat=0.5)
            w[INDEX["calf outer"]] = shank * belly(t, a, 0.03, 0.5, 148, 36, length, r, fat=0.5)
            w[INDEX["soleus"]] = shank * belly(t, a, 0.36, 0.8, 180, 80, length, r, fat=0.5)
        out.append(w)
    return out
