// Updated cinematic-effects.ts with shake motion and richer transition options
/**
 * FFmpeg cinematic filter builders — Ken Burns, grading, fades, film grain, and now shake motion.
 */

export type SceneMood = 'dark' | 'suspense' | 'emotional' | 'energetic' | 'calm' | 'story';
export type CameraMotion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'static' | 'shake' | 'slow-zoom';
export type SceneTransition = 'fade' | 'dissolve' | 'cut' | 'hblur' | 'slideleft' | 'slideright' | 'fadeblack';

export function detectMoodFromTopic(topic: string): SceneMood {
  const t = topic.toLowerCase();
  if (/horror|scary|creepy|terrifying|nightmare|ghost|murder|crime|true crime/.test(t)) return 'dark';
  if (/suspense|mystery|secret|hidden|conspiracy|unknown/.test(t)) return 'suspense';
  if (/motivat|inspir|success|heart|emotional|story/.test(t)) return 'emotional';
  if (/energy|fast|viral|shock|insane|crazy/.test(t)) return 'energetic';
  if (/tutorial|guide|calm|explain|learn/.test(t)) return 'calm';
  return 'story';
}

export function buildColorGradeFilter(mood: SceneMood): string {
  switch (mood) {
    case 'dark':
      return 'eq=brightness=-0.08:contrast=1.18:saturation=0.75,curves=preset=lighter';
    case 'suspense':
      return 'eq=brightness=-0.05:contrast=1.12:saturation=0.82,colorbalance=rs=-0.02:gs=0:bs=0.04';
    case 'emotional':
      return 'eq=brightness=0.02:contrast=1.08:saturation=1.05,colorbalance=rs=0.03:gs=0:bs=-0.02';
    case 'energetic':
      return 'eq=brightness=0.04:contrast=1.15:saturation=1.2';
    case 'calm':
      return 'eq=brightness=0.03:contrast=1.05:saturation=0.95';
    default:
      return 'eq=contrast=1.08:saturation=1.02';
  }
}

/** Subtle film grain + vignette for Hollywood feel */
export function buildCinematicOverlayFilter(mood: SceneMood): string {
  const grain = mood === 'dark' || mood === 'suspense' ? 12 : 8;
  // vignette pulse for emotional beats
  const vignette = mood === 'emotional' ? ',format=rgba,curves=all=' + "0/0 0.5/0.6 1/1" : '';
  return `noise=alls=${grain}:allf=t+u${vignette},vignette=PI/5`;
}

export function buildCameraMotionFilter(motion: CameraMotion, duration: number): string {
  // For shake, apply a subtle jitter using zoompan with random offset
  if (motion === 'shake') {
    const totalFrames = Math.round(duration * 30);
    // Small horizontal/vertical jitter between -2 and 2 pixels
    return `zoompan=z='1':x='if(mod(n,2),random(1)*2-2,0)':y='if(mod(n,2),random(1)*2-2,0)':d=${totalFrames}:s=1920x1080:fps=30`;
  }
  // For other motions, reuse existing zoom filter logic
  return buildZoomFilter(mapCameraToZoom(motion), duration);
}

export function buildSceneFadeFilter(duration: number, fadeIn = 0.6, fadeOut = 0.6): string {
  const fi = Math.min(fadeIn, duration * 0.15);
  const fo = Math.max(0, duration - Math.min(fadeOut, duration * 0.15));
  return `fade=t=in:st=0:d=${fi.toFixed(2)},fade=t=out:st=${fo.toFixed(2)}:d=${Math.min(fadeOut, duration * 0.15).toFixed(2)}`;
}

export function mapCameraToZoom(motion: CameraMotion): 'in' | 'out' | 'none' {
  if (motion === 'shake') return 'none'; // shake handled separately
  if (motion === 'zoom-in' || motion === 'pan-right' || motion === 'slow-zoom') return 'in';
  if (motion === 'zoom-out' || motion === 'pan-left') return 'out';
  return 'none';
}

/**
 * Randomly selects a camera motion based on scene index and mood.
 * Patterns include shake for horror/suspense to break repetition.
 */
export function selectCameraMotion(index: number, mood: SceneMood): CameraMotion {
  const basePatterns: CameraMotion[] =
    mood === 'dark' || mood === 'suspense'
      ? ['zoom-in', 'shake', 'zoom-in', 'pan-right', 'zoom-out']
      : ['zoom-in', 'pan-left', 'slow-zoom', 'zoom-in', 'static'];
  // Add a small random offset to avoid deterministic loops
  const offset = Math.floor(Math.random() * basePatterns.length);
  return basePatterns[(index + offset) % basePatterns.length];
}

/**
 * Returns a transition filter name matching the overall mood.
 * For horror/suspense we use a black fade; for energetic scenes a fast slide; otherwise a normal fade.
 */
export function xfadeTransitionForMood(mood: SceneMood): SceneTransition {
  if (mood === 'dark' || mood === 'suspense') return 'fadeblack';
  if (mood === 'energetic') return 'slideleft';
  if (mood === 'calm') return 'hblur';
  return 'fade';
}
