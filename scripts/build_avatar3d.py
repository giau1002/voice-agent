"""Build the kiosk's real skinned GLB with the CC0 MakeHuman asset set.

Run using Blender --background --factory-startup --python this_file.
See docs/avatar3d.md for source preparation and licenses.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / '.tools/avatar3d-assets'
sys.path.insert(0, str(ASSETS))
from bootstrap_mpfb import bootstrap
bootstrap()
from bl_ext.kiosk.mpfb.services import HumanService, TargetService, AssetService, ObjectService, ExportService
from bl_ext.kiosk.mpfb.services.faceservice import FaceService

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
details = TargetService.get_default_macro_info_dict()
details.update(gender=0.0, age=.5, muscle=.35, weight=.43, height=.48, proportions=.5, cupsize=.35, firmness=.6)
details['race'] = {'asian': .9, 'caucasian': .1, 'african': 0.0}
base = HumanService.create_human(macro_detail_dict=details)
base.name = 'AssistantBody'
skin = AssetService.find_asset_absolute_path('young_asian_female.mhmat', asset_subdir='skins')
assert skin, 'Missing CC0 system skin'
HumanService.set_character_skin(skin, base, skin_type='GAMEENGINE')
rig = HumanService.add_builtin_rig(base, 'game_engine')
rig.name = 'AssistantRig'
print('BODY_READY', base.dimensions[:], flush=True)

asset_list = [
    ('eyes', 'high-poly.mhclo', 'Eyes'),
    ('eyebrows', 'eyebrow001.mhclo', 'Eyebrows'),
    ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'),
    ('tongue', 'tongue01.mhclo', 'Tongue'),
    ('teeth', 'teeth_base.mhclo', 'Teeth'),
    ('hair', 'long01.mhclo', 'Hair'),
    ('clothes', 'female_elegantsuit01.mhclo', 'Clothes'),
]
for directory, filename, kind in asset_list:
    path = AssetService.find_asset_absolute_path(filename, asset_subdir=directory)
    assert path, f'Missing {filename}'
    HumanService.add_mhclo_asset(path, base, asset_type=kind, material_type='GAMEENGINE')
    print('ASSET', filename, flush=True)

# All editable identity shapes are baked BEFORE expression keys are added.
TargetService.bake_targets(base)
FaceService.load_targets(base, load_microsoft_visemes=False, load_meta_visemes=True, load_arkit_faceunits=True)
FaceService.interpolate_targets(base)
print('FACIAL_KEYS_READY', len(base.data.shape_keys.key_blocks), flush=True)
ExportService.bake_modifiers_remove_helpers(base, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)

def material(name, color, roughness=.65):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

white = material('Ivory cotton blouse', (.87,.89,.92))
navy = material('Navy skirt', (.018,.028,.055))
blue = material('Blue lanyard', (.025,.11,.48), .5)
badge_white = material('Badge white', (.93,.95,.97), .4)

for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    # Remove subdivision at runtime; retain clean smooth topology and all morphs.
    for mod in list(obj.modifiers):
        if mod.type == 'SUBSURF':
            obj.modifiers.remove(mod)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if 'elegantsuit' in obj.name.lower():
        obj.data.materials.clear()
        obj.data.materials.append(white)
        obj.data.materials.append(navy)
        for polygon in obj.data.polygons:
            center = sum((obj.matrix_world @ obj.data.vertices[v].co for v in polygon.vertices), Vector()) / len(polygon.vertices)
            polygon.material_index = 0 if center.z > .94 else 1
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            node.inputs['Metallic'].default_value = 0
            node.inputs['Roughness'].default_value = .52 if obj == base else .7
            if 'Emission Strength' in node.inputs:
                node.inputs['Emission Strength'].default_value = 0
            if obj == base:
                node.inputs['Base Color'].default_value = (1,1,1,1)
                node.inputs['Subsurface Weight'].default_value = .08
                node.inputs['Subsurface Radius'].default_value = (1,.4,.2)
            if 'hair' in obj.name.lower():
                mat.surface_render_method = 'DITHERED'
                mat.use_transparency_overlap = False

# Pose the arms down using their actual bone directions before baking the rest
# pose into mesh + facial shape keys. This avoids T-pose bounds and split limbs.
bpy.context.view_layer.update()
for name in ['upperarm_l', 'upperarm_r', 'upperarm.L', 'upperarm.R']:
    bone = rig.pose.bones.get(name)
    if not bone:
        continue
    current = (bone.tail - bone.head).normalized()
    desired = Vector((.16 if current.x > 0 else -.16, -.08, -1)).normalized()
    q = current.rotation_difference(desired)
    bone.rotation_mode = 'QUATERNION'
    rest = bone.matrix.to_quaternion()
    bone.rotation_quaternion = rest.inverted() @ q @ rest
print('RIG_BONES', [b.name for b in rig.pose.bones], flush=True)

# Export glTF carries bone pose; the runtime stores this as the initial pose.
out = ROOT / 'web/public/avatar3d'
out.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for child in ObjectService.get_list_of_children(rig):
    child.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(out/'assistant.glb'), export_format='GLB',
    use_selection=True, export_animations=False, export_morph=True,
    export_morph_normal=True, export_skins=True, export_yup=True,
    export_image_format='AUTO', export_materials='EXPORT')

manifest = {
    'generator': 'Blender 4.5.3 + MPFB 2.0.18',
    'asset_license': 'CC0-1.0',
    'source': 'https://github.com/makehumancommunity/mpfb2',
    'identity': 'Custom adult female created with MPFB; not an exact reconstruction of the reference photograph.',
    'bones': [b.name for b in rig.data.bones],
    'meshes': [{'name': o.name, 'vertices':len(o.data.vertices),
                'morphs': [k.name for k in o.data.shape_keys.key_blocks] if o.data.shape_keys else []}
               for o in bpy.context.scene.objects if o.type == 'MESH'],
}
(out/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

# Keep editable scene locally (too large for source control).
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'assistant.blend'))

# A physically rendered QA view of the exact exported geometry, no image edits.
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 700
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.world.color = (.35,.35,.35)
def light(name, position, energy, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector((0,0,1.4))-obj.location).to_track_quat('-Z','Y').to_euler()
light('Softbox key', (2,-3,3), 220, 3)
light('Softbox fill', (-2,-2,2), 120, 2)
light('Rim', (0,2,2.8), 180, 2)
camera_data = bpy.data.cameras.new('PortraitCamera')
camera = bpy.data.objects.new('PortraitCamera', camera_data)
scene.collection.objects.link(camera)
camera.location = (0,-3.2,1.4)
camera.rotation_euler = (Vector((0,0,1.3))-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.lens = 65
scene.camera = camera
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = str(ASSETS/'preview.png')
bpy.ops.render.render(write_still=True)
print('AVATAR_EXPORT_DONE', str(out/'assistant.glb'), flush=True)
