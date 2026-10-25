import {
  ACESFilmicToneMapping, Bone, Box3, Color, DirectionalLight, Euler, Group,
  HemisphereLight, Material, Mesh, Object3D, PerspectiveCamera, PMREMGenerator,
  Quaternion, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AvatarBodyMotion, AvatarFaceMotion, clamp01 } from './avatar3d-motion';

export interface Avatar3DFrame {
  weights: Pose; articulation: number; jaw: number; speaking: boolean; level: number;
  motion: boolean; intensity: number; reduced: boolean;
}
export interface Avatar3DOptions {
  modelUrl?: string;
  /** Full-body glTF is Y-up, facing +Z. Set false for an already framed bust. */
  normalizeHeight?: number | false;
  camera?: { target?: [number, number, number]; position?: [number, number, number]; fov?: number };
  signal?: AbortSignal;
}
export interface Avatar3DStats {
  skinnedMeshCount: number; boneCount: number; morphTargetCount: number; mappedMorphCount: number;
  hasSkinnedMesh: boolean; hasFaceControls: boolean; hasBlinkControls: boolean;
  faceMode: 'arkit' | 'visemes'; boneNames: string[]; morphNames: string[];
}

const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const faceNames = [
  'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthRollLower', 'mouthPressLeft', 'mouthPressRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'browInnerUp',
] as const;
const visemeAliases: Record<string, string> = {
  aa: 'AA', e: 'EE', ih: 'EE', oh: 'OH', ou: 'OO', pp: 'MBP', ff: 'FV', dd: 'TDL',
  sil: 'rest', ch: 'TDL', ss: 'TDL', nn: 'TDL', rr: 'TDL', th: 'TDL', kk: 'TDL',
};

/** MPFB's ARKit names and Meta names, including common namespace prefixes. */
export function mapAvatarMorph(name: string): string | null {
  const key = normalized(name);
  for (const faceName of faceNames) {
    const full = normalized(faceName), short = full.replace(/left$/, 'l').replace(/right$/, 'r');
    if (key === full || key.endsWith(full) || key === short) return faceName;
  }
  const meta = key.match(/(?:^|viseme|vrcv)(aa|e|ih|oh|ou|pp|ff|dd|sil|ch|ss|nn|rr|th|kk)$/);
  return meta ? `viseme:${visemeAliases[meta[1]]}:${meta[1]}` : null;
}

interface MorphBinding { mesh: Mesh; index: number; control: string }
interface BoneBinding { bone: Bone; rest: Quaternion }

function releaseModel(model: Object3D) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>();
  model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const image = texture.source?.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    texture.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
}

export class Avatar3D {
  readonly stats: Avatar3DStats;
  readonly engine = 'three-webgl2';
  lost = false;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private root = new Group();
  private environment: WebGLRenderTarget;
  private face = new AvatarFaceMotion();
  private body = new AvatarBodyMotion();
  private morphs: MorphBinding[] = [];
  private bones = new Map<string, BoneBinding>();
  private head?: BoneBinding;
  private neck?: BoneBinding;
  private chest?: BoneBinding;
  private eyes: BoneBinding[] = [];
  private parentRotation = new Quaternion();
  private deltaRotation = new Quaternion();
  private localRotation = new Quaternion();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private target = new Vector3();
  private height = 1.65;
  private disposed = false;
  private onContextLost = (event: Event) => { event.preventDefault(); this.lost = true; };

  static async create(canvas: HTMLCanvasElement, options: Avatar3DOptions = {}): Promise<Avatar3D> {
    const url = new URL(options.modelUrl || '/avatar3d/assistant.glb', document.baseURI);
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) throw new Error(`Không tải được nhân vật 3D (${response.status}).`);
    const file = await response.arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(file, new URL('.', url).href);
    if (options.signal?.aborted) { releaseModel(gltf.scene); throw new DOMException('Đã hủy tải nhân vật.', 'AbortError'); }
    try { return new Avatar3D(canvas, gltf.scene, options); }
    catch (error) { releaseModel(gltf.scene); throw error; }
  }

  private constructor(private canvas: HTMLCanvasElement, model: Group, private options: Avatar3DOptions) {
    const boneNames: string[] = [], morphNames = new Set<string>();
    let skinnedMeshCount = 0, morphTargetCount = 0;
    this.root.add(model); this.scene.add(this.root);
    model.traverse(object => {
      if (object instanceof Bone) {
        const binding = { bone: object, rest: object.quaternion.clone() };
        this.bones.set(normalized(object.name), binding); boneNames.push(object.name);
      }
      if (!(object instanceof Mesh)) return;
      if ('isSkinnedMesh' in object && object.isSkinnedMesh) skinnedMeshCount++;
      // Skinned facial shapes can exceed static bind-pose bounds slightly.
      object.frustumCulled = false;
      for (const [name, index] of Object.entries(object.morphTargetDictionary || {})) {
        morphTargetCount++; morphNames.add(name);
        const control = mapAvatarMorph(name);
        if (control) this.morphs.push({ mesh: object, index, control });
      }
    });
    const hasArkit = this.morphs.some(item => item.control === 'jawOpen');
    const hasVisemes = this.morphs.some(item => item.control.startsWith('viseme:AA:'));
    this.stats = {
      skinnedMeshCount, boneCount: boneNames.length, morphTargetCount, mappedMorphCount: this.morphs.length,
      hasSkinnedMesh: skinnedMeshCount > 0, hasFaceControls: hasArkit || hasVisemes,
      hasBlinkControls: this.morphs.some(item => item.control === 'eyeBlinkLeft') && this.morphs.some(item => item.control === 'eyeBlinkRight'),
      faceMode: hasArkit ? 'arkit' : 'visemes', boneNames, morphNames: [...morphNames],
    };
    if (!this.stats.hasSkinnedMesh || !this.stats.hasFaceControls) {
      throw new Error('Mô hình 3D thiếu khung xương hoặc bộ khẩu hình. Vui lòng kiểm tra file GLB.');
    }
    this.head = this.findBone(['head', 'mixamorigHead', 'DEF-head']);
    this.neck = this.findBone(['neck01', 'neck', 'mixamorigNeck', 'DEF-neck']);
    this.chest = this.findBone(['spine03', 'chest', 'mixamorigSpine2', 'DEF-spine003']);
    this.eyes = [this.findBone(['eye.L', 'eyeLeft', 'LeftEye']), this.findBone(['eye.R', 'eyeRight', 'RightEye'])].filter((bone): bone is BoneBinding => !!bone);

    this.root.updateMatrixWorld(true);
    const initial = new Box3().setFromObject(this.root), size = initial.getSize(new Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Mô hình nhân vật 3D có kích thước không hợp lệ.');
    const desired = options.normalizeHeight === false ? size.y : options.normalizeHeight || 1.65;
    const scale = desired / size.y;
    this.root.scale.setScalar(scale); this.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.root), center = bounds.getCenter(new Vector3());
    this.root.position.set(-center.x, -bounds.min.y, -center.z);
    this.root.updateMatrixWorld(true); this.height = desired;
    this.target.set(0, desired * .78, 0);
    if (options.camera?.target) this.target.fromArray(options.camera.target);
    this.camera = new PerspectiveCamera(options.camera?.fov || 29, 1, .05, 20);

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    this.scene.background = new Color('#edf5fb');
    const room = new RoomEnvironment(), pmrem = new PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .08);
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .65;
    room.dispose(); pmrem.dispose();
    this.scene.add(new HemisphereLight(0xffffff, 0xb9c8dc, 1.15));
    const key = new DirectionalLight(0xfff6ec, 2.6); key.position.set(-2, 3, 4); this.scene.add(key);
    const fill = new DirectionalLight(0xe0edff, 1.15); fill.position.set(3, 2, 2); this.scene.add(fill);
    const rim = new DirectionalLight(0xffffff, 1.4); rim.position.set(0, 2, -3); this.scene.add(rim);
    const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const texture of Object.values(material)) if (texture instanceof Texture) texture.anisotropy = anisotropy;
      }
    });
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  private findBone(names: string[]) { for (const name of names) { const bone = this.bones.get(normalized(name)); if (bone) return bone; } }

  /** Apply a world-oriented offset around a bone's authored rest transform.
   * Blender bone roll differs across rigs, so local Euler rotations are unsafe. */
  private rotateBone(binding: BoneBinding | undefined, pitch: number, yaw: number, roll: number) {
    if (!binding) return;
    const { bone, rest } = binding;
    bone.parent?.getWorldQuaternion(this.parentRotation);
    if (!bone.parent) this.parentRotation.identity();
    this.deltaRotation.setFromEuler(this.euler.set(pitch, yaw, roll));
    this.localRotation.copy(this.parentRotation).invert().multiply(this.deltaRotation).multiply(this.parentRotation).multiply(rest);
    bone.quaternion.copy(this.localRotation); bone.updateMatrixWorld(true);
  }

  resize(width = this.canvas.clientWidth || 560, height = this.canvas.clientHeight || 700) {
    if (this.disposed) return;
    width = Math.max(1, width); height = Math.max(1, height);
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height;
    if (this.options.camera?.position) this.camera.position.fromArray(this.options.camera.position);
    else {
      const halfFov = this.camera.fov * Math.PI / 360;
      const visibleHeight = this.height * .61;
      const distance = Math.max(visibleHeight / (2 * Math.tan(halfFov)), this.height * .37 / (2 * Math.tan(halfFov) * this.camera.aspect));
      this.camera.position.set(this.target.x, this.target.y, this.target.z + distance);
    }
    this.camera.lookAt(this.target); this.camera.updateProjectionMatrix();
  }

  update(now: number, dt: number, frame: Avatar3DFrame) {
    if (this.disposed) return;
    if (this.lost) throw new Error('Bộ vẽ 3D đã bị gián đoạn. Tải lại trang để khôi phục.');
    const face = this.face.update(frame, dt), body = this.body.update(now, dt, frame);
    const w = face.weights, open = face.opening;
    const smile = clamp01(body.smile + (w.smile || 0) * .3);
    const arkit: Record<string, number> = {
      jawOpen: open * .78,
      mouthClose: (w.MBP || 0) * .8,
      mouthFunnel: (w.OH || 0) * .52,
      mouthPucker: (w.OO || 0) * .64,
      mouthSmileLeft: smile, mouthSmileRight: smile,
      mouthStretchLeft: (w.EE || 0) * .26, mouthStretchRight: (w.EE || 0) * .26,
      mouthLowerDownLeft: open * .12, mouthLowerDownRight: open * .12,
      mouthUpperUpLeft: open * .08, mouthUpperUpRight: open * .08,
      mouthRollLower: (w.FV || 0) * .35,
      mouthPressLeft: (w.MBP || 0) * .25, mouthPressRight: (w.MBP || 0) * .25,
      eyeBlinkLeft: body.blink, eyeBlinkRight: body.blink,
      eyeSquintLeft: smile * .12, eyeSquintRight: smile * .12,
      browInnerUp: frame.speaking ? open * .025 : 0,
    };
    const vowelOpening = (w.AA || 0) + (w.EE || 0) * .5 + (w.OH || 0) * .78 + (w.OO || 0) * .58 + (w.FV || 0) * .22 + (w.TDL || 0) * .45;
    const visemeGain = vowelOpening > .001 ? open / vowelOpening : 0;
    for (const binding of this.morphs) {
      const influences = binding.mesh.morphTargetInfluences;
      if (!influences) continue;
      const control = binding.control;
      if (control.startsWith('viseme:')) {
        const [, shape, phoneme] = control.split(':');
        // One representative per ambiguous group avoids stacking identical
        // full-face targets when a model exposes all 15 Meta visemes.
        const representative = ({ AA: 'aa', EE: 'e', OH: 'oh', OO: 'ou', MBP: 'pp', FV: 'ff', TDL: 'dd' } as Record<string, string>)[shape];
        influences[binding.index] = this.stats.faceMode === 'visemes' && phoneme === representative
          ? clamp01((w[shape] || 0) * (shape === 'MBP' ? 1 : visemeGain)) : 0;
      } else {
        // Whole-mouth visemes already contain jaw opening; do not double it
        // with ARKit jaw and mouth geometry when using a viseme-only rig.
        const allowed = this.stats.faceMode === 'arkit' || control.startsWith('eye') || control.startsWith('brow') || control.startsWith('mouthSmile');
        influences[binding.index] = allowed ? clamp01(arkit[control] || 0) : 0;
      }
    }
    this.rotateBone(this.chest, body.chestPitch, 0, body.chestRoll);
    this.rotateBone(this.neck, body.pitch * .25, body.yaw * .25, body.roll * .25);
    this.rotateBone(this.head, body.pitch * .75, body.yaw * .75, body.roll * .75);
    for (const eye of this.eyes) this.rotateBone(eye, body.gazePitch, body.gazeYaw, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    releaseModel(this.root); this.environment.dispose(); this.renderer.dispose();
    this.scene.clear(); this.morphs = []; this.bones.clear();
  }
}
