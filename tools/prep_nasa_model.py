# Written with an AI tool (Claude). See AI_USE.md.
"""Make a small GLB for the app from a NASA 3D Resources model (SOURCES.md S39, S54).

blender -b --disable-autoexec -P tools/prep_nasa_model.py -- in.(blend|glb) out.glb report.json [max_tex] [keep]

What it does: opens the file, drops cameras and lights, scales every image down to max_tex pixels
on its longer side (default 1024), and exports one GLB with Draco mesh compression and JPEG
images. With keep below 1 (for example 0.03) every mesh is thinned to that share of its
triangles with Blender's Decimate modifier (collapse): the shape gets coarser, nothing is added.
Otherwise nothing is modelled or re-shaped. The report lists the objects with their parents and
sizes, so the app can pick the parts it turns (a mast, the wheels).
"""
import json
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, rep_path = argv[:3]
max_tex = int(argv[3]) if len(argv) > 3 else 1024
keep = float(argv[4]) if len(argv) > 4 else 1.0

if src.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

for o in list(bpy.data.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

if keep < 1:
    for o in bpy.data.objects:
        if o.type == "MESH":
            m = o.modifiers.new("thin", "DECIMATE")
            m.ratio = keep
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)

images = []
for im in bpy.data.images:
    if not im.size[0] or not im.size[1]:
        continue
    w, h = im.size
    k = max_tex / max(w, h)
    if k < 1:
        im.scale(max(1, round(w * k)), max(1, round(h * k)))
    images.append({"name": im.name, "from": [w, h], "to": list(im.size)})

lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
objs, tris = [], 0
for o in bpy.data.objects:
    row = {"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None,
           "loc": [round(v, 3) for v in o.matrix_world.translation]}
    if o.type == "MESH":
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        tris += n
        row["tris"] = n
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
        row["dims"] = [round(v, 3) for v in o.dimensions]
    objs.append(row)

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_draco_mesh_compression_enable=True,
                          export_image_format="JPEG", export_jpeg_quality=82, export_apply=True,
                          export_animations=True, export_yup=True)
json.dump({"source": src.split("/")[-1], "triangles": tris, "bbox_min": [round(v, 3) for v in lo],
           "bbox_max": [round(v, 3) for v in hi], "images": images, "objects": objs},
          open(rep_path, "w"), indent=1)
print("triangles", tris, "bbox", [round(v, 2) for v in lo], [round(v, 2) for v in hi], "objects", len(objs))
