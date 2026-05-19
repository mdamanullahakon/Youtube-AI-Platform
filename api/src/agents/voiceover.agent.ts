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
  const cleaned = await generateWithAI(`
    Clean this script for voiceover narration. Remove ALL:
    - Scene markers
    - Hook labels (---HOOK---, ---SCENE---, etc.)
    - Bracketed text like [Scene 1:]
    - Formatting instructions
    - Parenthetical notes

    Make the remaining text flow naturally for speech.
    Keep natural pauses marked with "...".
    Keep emphasis words like "absolutely", "completely", "nothing".

    Script:
    ${scriptContent}

    Return ONLY the clean narration text, no explanations.
  `, 'ollama', { temperature: 0.3 });

  const cleanedText = cleaned.trim();
  const ssmlText = convertToSSML(cleanedText, tone, language);

  return { cleanedText, ssmlText };
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

  const { cleanedText } = await generateVoiceoverContent(text, tone, language);
  const outputDir = join(process.cwd(), 'uploads', 'voiceovers');
  await mkdir(outputDir, { recursive: true });

  const timestamp = Date.now();
  const basePath = join(outputDir, `${projectId}_${timestamp}`);
  const mp3Path = basePath + '.mp3';

  const wordCount = cleanedText.split(/\s+/).length;
  const estimatedDuration = Math.ceil(wordCount / 2.5);

  const voiceoverResult = (audioUrl: string | null, duration: number): VoiceoverResult => ({
    text: cleanedText,
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

  aiLogger.info('Trying Edge TTS for voiceover');
  const edgeSuccess = await synthesizeSpeech(cleanedText, mp3Path, language);
  if (edgeSuccess) {
    aiLogger.info(`Voiceover via Edge TTS: ${mp3Path}`);
    return voiceoverResult(`/uploads/voiceovers/${projectId}_${timestamp}.mp3`, estimatedDuration);
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
