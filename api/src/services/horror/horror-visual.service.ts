import { logger } from '../../utils/logger';
import type { Scene } from '../../types';

export interface HorrorVisualPlan {
  cameraStyle: 'handheld' | 'cctv' | 'cinematic' | 'found-footage' | 'night-vision' | 'drone' | 'security-cam';
  lighting: 'dark' | 'flickering' | 'shadow-only' | 'single-source' | 'complete-dark' | 'moonlight' | 'strobe';
  environment: string;
  motionType: 'slow-zoom' | 'shake' | 'pan' | 'rapid-cut' | 'static-dread' | 'tracking-shot' | 'pov-run';
  colorGrade: string;
  soundAtmos: string;
}

const CAMERA_STYLES: HorrorVisualPlan['cameraStyle'][] = [
  'handheld', 'cctv', 'cinematic', 'found-footage', 'night-vision', 'drone', 'security-cam'
];

const LIGHTING_OPTIONS: HorrorVisualPlan['lighting'][] = [
  'dark', 'flickering', 'shadow-only', 'single-source', 'complete-dark', 'moonlight', 'strobe'
];

const MOTION_OPTIONS: HorrorVisualPlan['motionType'][] = [
  'slow-zoom', 'shake', 'pan', 'rapid-cut', 'static-dread', 'tracking-shot', 'pov-run'
];

const ENVIRONMENTS = [
  'abandoned hospital hallway, flickering fluorescent lights, wet floor reflects nothing',
  'forest at midnight, fog between trees, distant howl, camera flashlight only source',
  'basement staircase descending into pitch black, single bare bulb swinging',
  'empty school corridor, lockers slightly open, echo of footsteps that stop when you stop',
  'attic crawlspace, dust heavy in air, a childs toy in the corner that should not be there',
  'underground tunnel system, water dripping, walls covered in symbols drawn in something dark',
  'suburban house at 3am, all lights off, streetlamp casts long shadows through blinds',
  'abandoned asylum ward, beds with restraints, a wheelchair moves by itself',
  'cemetery in fog, headstones barely visible, silhouette stands too still between graves',
  'mirrored room, reflections do not match reality, one reflection is closer than it should be',
  'underground bunker, emergency lights dim, scratches on the metal door from the inside',
  'church interior at night, overturned pews, stained glass shattered, altar defaced with symbols',
];

const COLOR_GRADES = [
  'desaturated teal-orange, high contrast, crushed blacks',
  'green-tinted night vision, grainy',
  'cold blue-white, clinical horror',
  'sepia desaturated, aged footage look',
  'red-shifted, blood color cast',
  'monochrome high contrast, noir horror',
  'cold green, underground sickness',
];

export class HorrorVisualEngine {
  planScene(scene: Scene, index: number, totalScenes: number): HorrorVisualPlan {
    const cameraStyle = this.selectCameraStyle(index, totalScenes);
    const lighting = this.selectLighting(index, totalScenes, scene.text);
    const environment = this.selectEnvironment(scene.text, index);
    const motionType = this.selectMotion(index, totalScenes);
    const colorGrade = COLOR_GRADES[index % COLOR_GRADES.length];

    const textLower = scene.text.toLowerCase();
    let soundAtmos = this.detectSoundAtmosphere(textLower);

    if (textLower.includes('scream') || textLower.includes('running') || textLower.includes('chase')) {
      soundAtmos = 'HEARTBEAT_POUNDING + heavy breathing + running footsteps on gravel + distant scream';
    } else if (textLower.includes('whisper') || textLower.includes('silence') || textLower.includes('quiet')) {
      soundAtmos = 'DEAD_SILENCE + single high-pitched tinnitus tone + distant water drip';
    } else if (textLower.includes('reveal') || textLower.includes('truth') || textLower.includes('discovered')) {
      soundAtmos = 'LOW_FREQUENCY_RUMBLE + swelling sub-bass + audio distortion + sharp sting at reveal';
    } else if (textLower.includes('jump') || textLower.includes('sudden') || textLower.includes('shock')) {
      soundAtmos = 'SILENCE === silence === SILENCE === VIOLENT SCREAMER + BREAKING GLASS + REVERB TAIL';
    }

    return { cameraStyle, lighting, environment, motionType, colorGrade, soundAtmos };
  }

  private selectCameraStyle(index: number, total: number): HorrorVisualPlan['cameraStyle'] {
    if (index < 3) return 'handheld';
    if (index < 6) return 'cctv';
    if (index > total - 5) return 'security-cam';
    if (index % 7 === 0) return 'found-footage';
    if (index % 5 === 0) return 'night-vision';
    if (index % 11 === 0) return 'drone';
    return 'cinematic';
  }

  private selectLighting(index: number, total: number, text: string): HorrorVisualPlan['lighting'] {
    const textLower = text.toLowerCase();
    if (textLower.includes('dark') || textLower.includes('night') || textLower.includes('shadow')) return 'complete-dark';
    if (textLower.includes('flicker') || textLower.includes('light') || textLower.includes('bulb')) return 'flickering';
    if (textLower.includes('moon') || textLower.includes('star')) return 'moonlight';
    if (textLower.includes('strobe') || textLower.includes('flash')) return 'strobe';
    if (index > total - 3) return 'single-source';
    return LIGHTING_OPTIONS[index % LIGHTING_OPTIONS.length];
  }

  private selectEnvironment(text: string, index: number): string {
    const textLower = text.toLowerCase();
    const matched = ENVIRONMENTS.find(e => {
      const keywords = e.split(',');
      return keywords.some(k => textLower.includes(k.trim().split(' ')[0]));
    });
    if (matched) return matched;
    return ENVIRONMENTS[index % ENVIRONMENTS.length];
  }

  private selectMotion(index: number, total: number): HorrorVisualPlan['motionType'] {
    if (index === 0 || index === total - 1) return 'static-dread';
    if (index % 4 === 0) return 'rapid-cut';
    if (index % 3 === 0) return 'shake';
    if (index % 5 === 0) return 'pov-run';
    if (index % 7 === 0) return 'tracking-shot';
    return MOTION_OPTIONS[index % MOTION_OPTIONS.length];
  }

  private detectSoundAtmosphere(text: string): string {
    if (text.includes('?') && text.includes('why')) return 'DEAD_SILENCE + distant footsteps approaching';
    if (text.includes('...') || text.includes('pause')) return 'DRONING_AMBIENT + low frequency hum + wind through cracks';
    if (text.includes('!')) return 'DISTORTED_SCREAMER + glass shatter + reverb tail + heartbeat fading';
    return 'SUB_BASS_AMBIENT + distant wind + creaking floorboards + static electricity crackle';
  }

  generateVisualPrompt(scene: Scene, plan: HorrorVisualPlan): string {
    return [
      `Style: ${plan.cameraStyle}`,
      `Lighting: ${plan.lighting}`,
      `Motion: ${plan.motionType}`,
      `Color: ${plan.colorGrade}`,
      `Environment: ${plan.environment}`,
      `Sound: ${plan.soundAtmos}`,
      `Action: ${scene.text.substring(0, 100)}`,
    ].join(' | ');
  }
}
