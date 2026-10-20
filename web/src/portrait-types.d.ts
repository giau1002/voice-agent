type Pose = Record<string, number>;
interface PortraitMeta { width: number; height: number; [key: string]: unknown }
interface RigRenderer {
  engine: string;
  lost?: boolean;
  render(weights: Pose, blink: number, debug?: boolean, force?: boolean, motion?: Record<string, number>): void;
}
interface GentleController {
  enabled: boolean;
  setEnabled(enabled: boolean, now: number): void;
  setIntensity(value: number, now: number): void;
  update(now: number, options: { speaking: boolean; reduced?: boolean }): Record<string, number>;
}
interface Window {
  PortraitRig: PortraitMeta;
  PortraitCore: {
    pose(name: string): Pose;
    blend(a: Pose, b: Pose, value: number): Pose;
    smoothPose(a: Pose, b: Pose, dt: number): Pose;
    wordPlan(word: string, lang: string): { name: string; weight: number }[];
    tokenize(text: string, lang: string, rate: number): { text: string; plan: { name: string; weight: number }[]; duration: number; pause: number }[];
    BlinkController: new (options: { min: number; max: number; duration: number }) => {
      update(now: number): number; trigger(now: number): void;
    };
    SpeechPlanner: new () => {
      start(text: string, lang: string, now: number, rate: number): unknown;
      sample(now: number): { weights: Pose; articulation?: number };
    };
  };
  PortraitRendering: {
    controls(weights: Pose, blink: number, motion?: Record<string, number>): number[];
    PortraitRenderer: new (canvas: HTMLCanvasElement, portrait: HTMLImageElement, options: {
      motionAtlas: HTMLImageElement; flowAtlas: HTMLImageElement; mouthAtlas: HTMLImageElement;
      characterLayer: HTMLImageElement; forceSoftware?: boolean; transparentBackground?: boolean;
    }) => RigRenderer;
  };
  PortraitGentleMotion: { GentleMotion: new () => GentleController };
}
