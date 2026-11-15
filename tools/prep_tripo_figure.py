"""Prepare the Tripo-rigged EV2 for the app: rename clips to Walk/Idle, shrink textures, measure
how far one walk loop goes (stance speed of the feet), export GLB.

blender -b -P tools/prep_tripo_figure.py -- in.glb out.glb report.json [max_tex]
"""
import json, sys, statistics
import bpy
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
IN, OUT, REP = a[0], a[1], a[2]
MAXTEX = int(a[3]) if len(a) > 3 else 2048
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
rep = {"actions_in": [x.name for x in bpy.data.actions]}
for act in bpy.data.actions:
    low = act.name.lower()
    if low.startswith("walk"): act.name = "Walk"
    elif low.startswith("idle"): act.name = "Idle"
rep["actions_out"] = [x.name for x in bpy.data.actions]
scene = bpy.context.scene
fps = scene.render.fps / scene.render.fps_base
rep["fps"] = fps

def use(act):
    ad = arm.animation_data or arm.animation_data_create()
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots: ad.action_slot = act.slots[0]

# rest height of the mesh (what the app scales to 1.9 m)
use(bpy.data.actions["Idle"]); scene.frame_set(int(bpy.data.actions["Idle"].frame_range[0]))
dg = bpy.context.evaluated_depsgraph_get()
me = mesh.evaluated_get(dg).to_mesh()
zs = [ (mesh.matrix_world @ v.co).z for v in me.vertices ]
ys = [ (mesh.matrix_world @ v.co).y for v in me.vertices ]
rep["idle_height"] = max(zs) - min(zs); rep["idle_low"] = min(zs)
mesh.evaluated_get(dg).to_mesh_clear()
bb = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
rep["rest_height_bbox"] = max(v.z for v in bb) - min(v.z for v in bb)

walk = bpy.data.actions["Walk"]; use(walk)
f0, f1 = int(walk.frame_range[0]), int(walk.frame_range[1])
rep["walk_frames"] = [f0, f1]
feet = {s: arm.pose.bones[f"mixamorig:{s}ToeBase"] for s in ("Left", "Right")}
heel = {s: arm.pose.bones[f"mixamorig:{s}Foot"] for s in ("Left", "Right")}
hips = arm.pose.bones["mixamorig:Hips"]
track = {s: [] for s in feet}; hip = []
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    for s in feet:
        p = arm.matrix_world @ ((feet[s].head + heel[s].head) / 2)
        track[s].append(p.copy())
    hip.append((arm.matrix_world @ hips.head).copy())
rep["hip_travel_xy"] = [(hip[-1] - hip[0]).x, (hip[-1] - hip[0]).y]
lowz = min(p.z for s in track for p in track[s])
speeds = []
for s in track:
    t = track[s]
    for i in range(1, len(t)):
        if t[i].z < lowz + 0.02 and t[i - 1].z < lowz + 0.02:
            d = (t[i] - t[i - 1]); speeds.append(Vector((d.x, d.y, 0)).length * fps)
rep["stance_samples"] = len(speeds)
rep["stance_speed_file_units_per_s"] = statistics.median(speeds) if speeds else None
rep["walk_loop_seconds"] = (f1 - f0) / fps
if speeds:
    rep["walk_units_per_loop"] = rep["stance_speed_file_units_per_s"] * rep["walk_loop_seconds"]
    rep["walk_m_per_loop_at_1_9m"] = rep["walk_units_per_loop"] * 1.9 / rep["rest_height_bbox"]
# facing: which way the toes point from the heels at rest-ish frame
scene.frame_set(f0)
fwd = (arm.matrix_world @ feet["Left"].tail) - (arm.matrix_world @ heel["Left"].head)
rep["toe_dir_blender_xy"] = [round(fwd.x, 3), round(fwd.y, 3)]

for img in bpy.data.images:
    if img.size[0] > MAXTEX:
        rep.setdefault("tex", []).append([img.name, list(img.size)])
        img.scale(MAXTEX, MAXTEX)
        img.pack()
ad = arm.animation_data; ad.action = None
for t in ad.nla_tracks: t.mute = False
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_animations=True,
    export_animation_mode="ACTIONS", export_image_format="JPEG", export_jpeg_quality=85,
    export_force_sampling=True, export_frame_step=1)
json.dump(rep, open(REP, "w"), indent=1, default=str)
print(json.dumps(rep, indent=1, default=str))
