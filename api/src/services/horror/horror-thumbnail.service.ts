export interface HorrorThumbnailConcept {
  prompt: string;
  style: string;
  textOverlay: string;
  predictedCtr: number;
  colorPalette: string[];
  emotion: string;
}

const HORROR_OVERLAYS = [
  'DON\'T WATCH THIS',
  'SOMETHING IS HERE',
  'IT WAS REAL',
  'LAST FOOTAGE',
  'NEVER ALONE',
  'BURIED SECRETS',
  'THE TRUTH',
  'THEY KNOW',
  'YOU\'RE NEXT',
  'DO NOT OPEN',
  'IT\'S INSIDE',
  'FOUND THIS',
  'NIGHT OF',
  'THE HUNT',
  'SOMEONE IS WATCHING',
];

const HORROR_STYLES = [
  { name: 'face-closeup-terror', desc: 'Close-up face with extreme terror expression, single eye visible, mouth open in silent scream, dark background with rim light' },
  { name: 'entity-reveal', desc: 'Shadow entity in doorway, silhouette with glowing eyes, fog at ground level, single light source from behind entity' },
  { name: 'found-footage-static', desc: 'VHS-style grainy footage, timestamp in corner, something barely visible in the dark background, scan lines' },
  { name: 'abandoned-location', desc: 'Abandoned building interior, flashlight beam revealing something wrong on the wall, dust particles in light' },
  { name: 'text-minimal-horror', desc: 'Pure black background, white text in horror font, bold 2-3 words, subtle face hidden in the dark negative space' },
  { name: 'cctv-capture', desc: 'CCTV camera angle, greenish tint, grainy, timestamp, humanoid figure standing too still in frame, date: unknown' },
  { name: 'mirror-reflection', desc: 'Mirror in dark room, reflection shows something different from reality, hand print on glass, cracked mirror' },
  { name: 'night-vision', desc: 'Green night vision POV, running through woods, something pale between trees, motion blur' },
];

export class HorrorThumbnailGenerator {
  generateConcepts(topic: string, hook: string): HorrorThumbnailConcept[] {
    const concepts: HorrorThumbnailConcept[] = [];

    const stylePool = topic.toLowerCase().includes('found') || topic.toLowerCase().includes('footage')
      ? HORROR_STYLES.filter(s => s.name === 'found-footage-static' || s.name === 'cctv-capture' || s.name === 'night-vision')
      : topic.toLowerCase().includes('house') || topic.toLowerCase().includes('home')
        ? HORROR_STYLES.filter(s => s.name === 'abandoned-location' || s.name === 'mirror-reflection')
        : HORROR_STYLES;

    for (let i = 0; i < Math.min(5, stylePool.length); i++) {
      const style = stylePool[i];
      const overlay = HORROR_OVERLAYS[Math.floor(Math.random() * HORROR_OVERLAYS.length)];
      const ctr = this.predictCTR(style.name, i);

      let prompt: string;
      if (style.name === 'face-closeup-terror') {
        prompt = `Extreme close-up of a terrified face, only one eye and mouth visible, single tear, pitch black background, subtle rim light, photorealistic horror, film grain, 4K, cinematic lighting, the fear must be visceral`;
      } else if (style.name === 'entity-reveal') {
        prompt = `Dark silhouette of a humanoid entity standing in a doorway, two glowing white eyes, fog at ground level, light from behind creates silhouette, grainy footage aesthetic, horror, dread, something deeply wrong`;
      } else if (style.name === 'found-footage-static') {
        prompt = `1990s VHS camcorder footage, grainy, timestamp in bottom right "1997-10-31 03:14AM", dark room, flashlight beam barely illuminates a figure in the background, scan lines, distortion`;
      } else if (style.name === 'abandoned-location') {
        prompt = `Abandoned ${topic} interior, single flashlight beam cutting through darkness, dust particles, wall has writings in what looks like red, peeling wallpaper, damp, cold atmosphere`;
      } else if (style.name === 'text-minimal-horror') {
        prompt = `Pure black background, bold white horror typography reading "${overlay}", subtle face shape barely visible in the darkness, high contrast, minimalist dread`;
      } else if (style.name === 'cctv-capture') {
        prompt = `CCTV security camera footage, green tint, grainy, 4:3 aspect ratio, timestamp "UNKNOWN", empty hallway except for a humanoid figure standing impossibly still, too tall`;
      } else if (style.name === 'mirror-reflection') {
        prompt = `Dark bathroom mirror, reflection shows a person standing behind the viewer but the room behind them is empty, handprint on glass, cracked mirror, single dim light`;
      } else {
        prompt = `${style.desc}, ${topic}, ultra realistic, cinematic horror, dark atmosphere, high contrast lighting, film grain, 4K`;
      }

      concepts.push({
        prompt,
        style: style.name,
        textOverlay: overlay,
        predictedCtr: ctr,
        colorPalette: this.getPalette(style.name),
        emotion: 'fear-dread-curiosity',
      });
    }

    return concepts.sort((a, b) => b.predictedCtr - a.predictedCtr);
  }

  pickBestConcept(concepts: HorrorThumbnailConcept[]): HorrorThumbnailConcept {
    return concepts[0];
  }

  private predictCTR(style: string, index: number): number {
    const baseScores: Record<string, number> = {
      'face-closeup-terror': 14.2,
      'entity-reveal': 13.8,
      'found-footage-static': 12.5,
      'abandoned-location': 11.2,
      'text-minimal-horror': 10.8,
      'cctv-capture': 12.1,
      'mirror-reflection': 11.5,
      'night-vision': 10.2,
    };
    return (baseScores[style] || 10) - (index * 0.5);
  }

  private getPalette(style: string): string[] {
    const palettes: Record<string, string[]> = {
      'face-closeup-terror': ['#000000', '#1a0000', '#ff2200', '#ffffff'],
      'entity-reveal': ['#000000', '#0a0a0a', '#ffffcc', '#333333'],
      'found-footage-static': ['#0a0a0a', '#334433', '#88aa88', '#ffffff'],
      'abandoned-location': ['#1a0a00', '#000000', '#442200', '#ff6600'],
      'text-minimal-horror': ['#000000', '#111111', '#ffffff', '#ff0000'],
      'cctv-capture': ['#0a1a0a', '#224422', '#88ff88', '#ffffff'],
      'mirror-reflection': ['#0a0a1a', '#1a1a3a', '#aaaacc', '#ffffff'],
      'night-vision': ['#00ff00', '#003300', '#000000', '#ffffff'],
    };
    return palettes[style] || ['#000000', '#1a0000', '#ff0000', '#ffffff'];
  }
}
