import { generateWithAI } from '../services/ai.service';
import { generateWithCoqui } from '../services/coqui.service';
import { synthesizeSpeech } from '../services/edge-tts.service';
import { generateVoiceover as generateElevenLabs } from '../services/elevenlabs.service';
import { generateFallbackAudio } from '../services/fallback-tts.service';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { aiLogger } from '../utils/logger';
import type { VoiceoverResult } from '../types';

export async function generateVoiceoverContent(
  scriptContent: string,
  tone: string = 'emotional',
  language: string = 'en'
): Promise<{ cleanedText: string; ssmlText: string }> {
  // Use regex-based cleanup directly (faster and more reliable than AI for this task)
  const cleanedText = scriptContent
    .replace(/\[.*?\]/g, '')
    .replace(/---\w+---/g, '')
    .replace(/Scene \d+:?/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^.*?:\s*/gm, '')
    .replace(/\|.*?\|/g, '')
    .trim();

  // Enrich text with emphasis markers for natural speech patterns
  const enrichedText = enrichSpeechPatterns(cleanedText || scriptContent);
  const ssmlText = convertToSSML(enrichedText, tone, language);

  return { cleanedText: enrichedText, ssmlText };
}

function enrichSpeechPatterns(text: string): string {
  let result = text;

  // Add natural pauses after rhetorical questions
  result = result.replace(/(\?)\s/g, '$1... ');
  // Add emphasis around key power words
  const emphasisWords = ['absolutely', 'completely', 'nothing', 'everything', 'never', 'always', 'impossible', 'guaranteed', 'secret', 'hidden', 'shocking', 'genius'];
  for (const word of emphasisWords) {
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    result = result.replace(regex, '... $1 ...');
  }
  // Clean up multiple consecutive pauses
  result = result.replace(/\.{4,}/g, '...').replace(/\.\.\.\s+\.\.\./g, '...').replace(/\s{3,}/g, ' ');

  return result;
}

function convertToSSML(text: string, tone: string, language: string): string {
  const rate = tone === 'excited' ? 'fast' : tone === 'calm' ? 'slow' : 'medium';

  return `<?xml version="1.0"?>
<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
  <prosody rate="${rate}" pitch="medium">
    ${text
      .replace(/\.\.\./g, '<break time="600ms"/>')
      .replace(/\./g, '<break time="250ms"/>')
      .replace(/\!/g, '<break time="300ms"/>')
      .replace(/\?/g, '<break time="350ms"/>')
      .replace(/—/g, '<break time="400ms"/>')}
  </prosody>
</speak>`;
}

export async function createVoiceover(
  text: string,
  projectId: string,
  language: string = 'en',
  tone: string = 'emotional'
): Promise<VoiceoverResult> {
  aiLogger.info(`Creating voiceover for project ${projectId} (${language}, ${tone})`);

  const { cleanedText, ssmlText } = await generateVoiceoverContent(text, tone, language);
  const outputDir = join(process.cwd(), 'uploads', 'voiceovers');
  await mkdir(outputDir, { recursive: true });

  const timestamp = Date.now();
  const basePath = join(outputDir, `${projectId}_${timestamp}`);
  const mp3Path = basePath + '.mp3';

  const wordCount = cleanedText.split(/\s+/).length;
  const estimatedDuration = Math.ceil(wordCount / 2.5);

  const voiceoverResult = (audioUrl: string | null, duration: number, textUsed: string = cleanedText): VoiceoverResult => ({
    text: textUsed,
    audioUrl,
    duration,
    language,
    tone,
  });

  try {
    const elevenLabsOk = await generateElevenLabs(cleanedText, mp3Path, tone);
    if (elevenLabsOk) {
      aiLogger.info(`Voiceover via ElevenLabs: ${mp3Path}`);
      return voiceoverResult(`/uploads/voiceovers/${projectId}_${timestamp}.mp3`, estimatedDuration);
    }
  } catch (err: any) {
    aiLogger.warn(`ElevenLabs failed, trying fallback: ${err.message}`);
  }

  aiLogger.info('Trying Edge TTS for voiceover (with SSML for natural speech)');
  const edgeSuccess = await synthesizeSpeech(ssmlText, mp3Path, language);
  if (edgeSuccess) {
    aiLogger.info(`Voiceover via Edge TTS (SSML): ${mp3Path}`);
    return voiceoverResult(`/uploads/voiceovers/${projectId}_${timestamp}.mp3`, estimatedDuration, cleanedText);
  }

  aiLogger.info('Edge TTS unavailable, trying Coqui TTS fallback');
  const coquiSuccess = await generateWithCoqui(cleanedText, mp3Path, language);
  if (coquiSuccess) {
    aiLogger.info(`Voiceover via Coqui TTS: ${mp3Path}`);
    return voiceoverResult(`/uploads/voiceovers/${projectId}_${timestamp}.mp3`, estimatedDuration);
  }

  aiLogger.warn('All TTS options failed, using native fallback audio');
  const fallbackPath = mp3Path.replace(/\.mp3$/, '.wav');
  const fallbackSuccess = await generateFallbackAudio(cleanedText, fallbackPath, language);
  if (fallbackSuccess) {
    aiLogger.info(`Voiceover via fallback WAV: ${fallbackPath}`);
    return voiceoverResult(`/uploads/voiceovers/${projectId}_${timestamp}.wav`, estimatedDuration);
  }

  aiLogger.error('ALL audio generation paths failed');
  return voiceoverResult(null, estimatedDuration);
}
