# Assigns every vertex of the body a weight (0 to 1) for each muscle group of the exercise library, from where the
# vertex lies relative to the bones and which way its surface faces. The names are the library's own, so the player can
# tint "quadriceps" or "chest" for an exercise directly. Works on the rest pose (A-pose, facing -Y, Z up).
import math

import mathutils

MUSCLES = ["abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders", "traps", "triceps"]
INDEX = {m: i for i, m in enumerate(MUSCLES)}


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


# The torso muscles as outlines (distance from the midline, height) on this body, in metres.
CHEST = [(-0.03, 1.395), (0.12, 1.40), (0.19, 1.35), (0.175, 1.28), (0.12, 1.235), (0.05, 1.215), (-0.03, 1.215)]
RECTUS = [(-0.03, 1.195), (0.085, 1.195), (0.095, 1.0), (0.06, 0.96), (-0.03, 0.96)]
OBLIQUES = [(0.10, 1.15), (0.17, 1.15), (0.17, 1.0), (0.12, 0.97)]
LATS = [(0.115, 1.255), (0.17, 1.26), (0.185, 1.18), (0.16, 1.06), (0.10, 0.97), (0.04, 0.97), (0.05, 1.06), (0.07, 1.16)]
MIDDLE_BACK = [(-0.05, 1.37), (0.02, 1.37), (0.055, 1.33), (0.075, 1.26), (0.055, 1.19), (0.02, 1.14), (-0.05, 1.14)]
LOWER_BACK = [(-0.01, 1.18), (0.075, 1.17), (0.08, 1.0), (0.06, 0.95), (-0.01, 0.95)]
TRAPS = [(-0.05, 1.52), (0.05, 1.51), (0.12, 1.46), (0.21, 1.405), (0.19, 1.375), (0.11, 1.385), (0.05, 1.30), (0.02, 1.2), (-0.05, 1.2)]
GLUTES = [(-0.02, 0.985), (0.12, 0.99), (0.17, 0.95), (0.17, 0.87), (0.12, 0.82), (-0.02, 0.82)]


def compute(mesh, rig):
    """Returns a list with, per vertex, a list of weights in MUSCLES order."""
    world = rig.matrix_world
    bones = {b.name: (world @ b.head_local, world @ b.tail_local) for b in rig.data.bones}
    mw = mesh.matrix_world
    groups = {g.index: g.name for g in mesh.vertex_groups}
    pelvis_z = bones["pelvis"][0].z
    shoulder = bones["upperarm_l"][0]
    neck_z = bones["neck_01"][0].z

    def frame(bone):
        head, tail = bones[bone]
        axis = (tail - head)
        length = axis.length
        axis = axis / length
        front = mathutils.Vector((0, -1, 0))
        front = (front - axis * front.dot(axis)).normalized()
        return head, axis, length, front

    frames = {n: frame(n) for n in ("thigh_l", "thigh_r", "calf_l", "calf_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r")}
    out = []
    for v in mesh.data.vertices:
        p = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        nf = max(0.0, -n.y)  # facing forward
        nb = max(0.0, n.y)  # facing backward
        front = ss(0.1, 0.55, nf)
        back = ss(0.1, 0.55, nb)
        ax = abs(p.x)
        z = p.z
        w = [0.0] * len(MUSCLES)
        bw = {groups[g.group]: g.weight for g in v.groups if groups[g.group] in bones}

        # ----- torso: soft ovals around where each muscle sits (x is measured from the midline) -----
        def oval(cx, cz, rx, rz):
            d = math.sqrt(((ax - cx) / rx) ** 2 + ((z - cz) / rz) ** 2)
            return 1 - ss(0.5, 1.0, d)

        sideways = ss(-0.15, 0.35, n.y)  # facing back, or turned to the side
        w[INDEX["chest"]] = front * poly(CHEST, ax, z, 0.02)
        w[INDEX["abdominals"]] = max(front * poly(RECTUS, ax, z, 0.015), 0.6 * front * poly(OBLIQUES, ax, z, 0.015))
        w[INDEX["lats"]] = sideways * poly(LATS, ax, z, 0.025)
        w[INDEX["middle back"]] = back * poly(MIDDLE_BACK, ax, z, 0.025)
        w[INDEX["lower back"]] = back * poly(LOWER_BACK, ax, z, 0.02)
        w[INDEX["traps"]] = max(back, ss(0.55, 0.9, n.z)) * poly(TRAPS, ax, z, 0.02)
        w[INDEX["neck"]] = band(1.42, 1.47, 1.6, 1.66, z) * (1 - ss(0.06, 0.1, ax))
        w[INDEX["glutes"]] = back * poly(GLUTES, ax, z, 0.02)
        # the shoulder cap: near the shoulder joint, on the outside of the body
        d = math.sqrt(((ax - shoulder.x) * 1.0) ** 2 + (p.y - shoulder.y) ** 2 * 1.2 + (z - shoulder.z) ** 2)
        w[INDEX["shoulders"]] = (1 - ss(0.07, 0.15, d)) * ss(0.12, 0.2, ax)

        # ----- limbs, by place along the bone and angle around it -----
        side = "l" if p.x >= 0 else "r"
        sgn = 1 if p.x >= 0 else -1

        def around(bone):
            head, axis, length, fwd = frames[bone]
            rel = p - head
            t = rel.dot(axis) / length
            radial = rel - axis * rel.dot(axis)
            r = radial.length or 1e-6
            cos_f = radial.dot(fwd) / r
            lateral = radial.dot(mathutils.Vector((sgn, 0, 0))) / r  # + toward the outside of the body
            return t, cos_f, lateral

        wt = bw.get(f"thigh_{side}", 0.0)
        if wt > 0.0:
            t, cf, lat = around(f"thigh_{side}")
            along = band(-0.02, 0.1, 0.9, 1.02, t)
            w[INDEX["quadriceps"]] = wt * along * ss(0.1, 0.7, cf)
            w[INDEX["hamstrings"]] = wt * along * ss(0.1, 0.7, -cf)
            w[INDEX["adductors"]] = wt * band(0.0, 0.08, 0.7, 0.85, t) * ss(0.45, 0.9, -lat) * (1 - ss(0.5, 0.9, abs(cf)))
            w[INDEX["abductors"]] = wt * band(-0.1, 0.0, 0.3, 0.45, t) * ss(0.45, 0.9, lat) * (1 - ss(0.6, 0.95, abs(cf)))
        wc = bw.get(f"calf_{side}", 0.0)
        if wc > 0.0:
            t, cf, lat = around(f"calf_{side}")
            w[INDEX["calves"]] = wc * band(-0.02, 0.1, 0.62, 0.8, t) * ss(0.1, 0.7, -cf)
        wu = bw.get(f"upperarm_{side}", 0.0)
        if wu > 0.0:
            t, cf, lat = around(f"upperarm_{side}")
            along = band(-0.02, 0.15, 0.85, 1.0, t)
            w[INDEX["biceps"]] = wu * along * ss(0.15, 0.7, cf)
            w[INDEX["triceps"]] = wu * along * ss(0.15, 0.7, -cf)
        wl = bw.get(f"lowerarm_{side}", 0.0)
        if wl > 0.0:
            t, cf, lat = around(f"lowerarm_{side}")
            w[INDEX["forearms"]] = wl * band(-0.02, 0.08, 0.8, 1.0, t)
        out.append(w)
    return out
