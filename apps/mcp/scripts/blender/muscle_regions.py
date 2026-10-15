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

        w[INDEX["chest"]] = front * oval(0.098, 1.285, 0.14, 0.105)
        w[INDEX["abdominals"]] = max(front * oval(0.04, 1.07, 0.085, 0.14), 0.6 * oval(0.19, 1.07, 0.06, 0.1))
        w[INDEX["lats"]] = back * oval(0.17, 1.2, 0.1, 0.16)
        w[INDEX["middle back"]] = back * oval(0.0, 1.27, 0.1, 0.1)
        w[INDEX["lower back"]] = back * oval(0.05, 1.0, 0.07, 0.1)
        w[INDEX["traps"]] = max(back, ss(0.55, 0.9, n.z)) * oval(0.0, 1.42, 0.2, 0.075)
        w[INDEX["neck"]] = band(1.42, 1.47, 1.6, 1.66, z) * (1 - ss(0.06, 0.1, ax))
        w[INDEX["glutes"]] = back * oval(0.1, 0.91, 0.1, 0.095)
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
