import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

const FONT_CANDIDATES: Array<{ os: string; path: string }> = [
  { os: 'win32', path: 'C:\\Windows\\Fonts\\arial.ttf' },
  { os: 'win32', path: 'C:\\Windows\\Fonts\\segoeui.ttf' },
  { os: 'win32', path: 'C:\\Windows\\Fonts\\tahoma.ttf' },
  { os: 'win32', path: 'C:\\Windows\\Fonts\\calibri.ttf' },

  { os: 'linux', path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
  { os: 'linux', path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' },
  { os: 'linux', path: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf' },
  { os: 'linux', path: '/usr/share/fonts/noto/NotoSans-Regular.ttf' },

  { os: 'darwin', path: '/System/Library/Fonts/Helvetica.ttc' },
  { os: 'darwin', path: '/Library/Fonts/Arial.ttf' },
  { os: 'darwin', path: '/System/Library/Fonts/SFNSText.ttf' },
];

const PLATFORM = process.platform;

let resolvedFont: string | null = null;

export function resolveFontPath(): string {
  if (resolvedFont) return resolvedFont;

  const envFont = process.env.FONT_PATH;
  if (envFont && existsSync(envFont)) {
    resolvedFont = envFont;
    return resolvedFont;
  }

  for (const candidate of FONT_CANDIDATES) {
    if (candidate.os === PLATFORM && existsSync(candidate.path)) {
      resolvedFont = candidate.path;
      logger.info(`[FontResolver] Found system font: ${resolvedFont}`);
      return resolvedFont;
    }
  }

  const bundledFont = join(process.cwd(), '..', 'api', 'assets', 'fonts', 'NotoSans-Regular.ttf');
  if (existsSync(bundledFont)) {
    resolvedFont = bundledFont;
    logger.info(`[FontResolver] Using bundled font: ${resolvedFont}`);
    return resolvedFont;
  }

  logger.warn('[FontResolver] No font found — rendering may fail');
  resolvedFont = process.env.FONT_PATH || 'C\\:/Windows/Fonts/arial.ttf';
  return resolvedFont;
}

export function escapeFontPath(fontPath: string): string {
  return fontPath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\''");
}

export function resetFontCache(): void {
  resolvedFont = null;
}
