// Simple BullMQ worker scaffold processing script-generation and video-render jobs
import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { createReadStream } from 'fs';
import { join } from 'path';
import { generateText } from '../services/llm.service';
import { generateScript } from '../services/script.service';
import { synthesizeSpeech } from '../services/tts.service';
import { renderVideo } from '../services/ffmpeg.service';

const connection = redisConnection || { host: '127.0.0.1', port: 6379 } as any;

function safeJoinTmp(name: string) {
  return join(process.cwd(), 'tmp', name);
}

// Worker that handles multiple named queues for Phase1 scaffold
const worker = new Worker(
  'script-generation',
  async (job: Job) => {
    const { topic, language } = job.data;
    job.updateProgress?.(10);

    // Prefer LLM-based script generation if available
    let script = '';
    try {
      script = await generateText(`Write a short YouTube script about: ${topic} in ${language || 'English'}`);
    } catch (err) {
      script = await generateScript({ topic, language });
    }

    job.updateProgress?.(60);
    // Persist script artifact
    const scriptPath = safeJoinTmp(`script-${Date.now()}.txt`);
    await import('fs').then(fs => fs.promises.writeFile(scriptPath, script, 'utf8'));

    job.updateProgress?.(100);
    return { scriptPath };
  },
  { connection },
);

// Also create a worker for video-render queue
const renderWorker = new Worker(
  'video-render',
  async (job: Job) => {
    const { scriptPath, image } = job.data;
    job.updateProgress?.(5);

    // Read script
    const script = await import('fs').then(fs => fs.promises.readFile(scriptPath, 'utf8'));

    job.updateProgress?.(20);
    // TTS (scaffold returns placeholder path)
    const audioPath = await synthesizeSpeech(script, { language: 'en' });

    job.updateProgress?.(60);
    // Render video
    const out = safeJoinTmp(`video-${Date.now()}.mp4`);
    await renderVideo({ image, audio: audioPath, output: out, duration: 30 }).catch(err => {
      throw err;
    });

    job.updateProgress?.(100);
    return { videoPath: out };
  },
  { connection },
);

worker.on('completed', (job) => console.info(`Script job completed ${job.id}`));
worker.on('failed', (job, err) => console.error(`Script job failed ${job?.id}`, err));
renderWorker.on('completed', (job) => console.info(`Render job completed ${job.id}`));
renderWorker.on('failed', (job, err) => console.error(`Render job failed ${job?.id}`, err));

export { worker, renderWorker };
export default worker;