// End-to-end Phase 1 test — validates script → TTS → render → output pipeline
import { generateScript } from '../services/script.service';
import { synthesizeSpeech } from '../services/tts.service';
import { renderVideo } from '../services/ffmpeg.service';
import { promises as fs } from 'fs';
import { join } from 'path';

async function testPhase1Pipeline() {
  console.log('═══════════════════════════════════════════');
  console.log('  PHASE 1 — END-TO-END PIPELINE TEST');
  console.log('═══════════════════════════════════════════\n');

  const topic = 'AI automation for beginners';
  const outDir = join(process.cwd(), 'test-outputs');
  await fs.mkdir(outDir, { recursive: true });

  try {
    // Step 1: Generate script
    console.log('[STEP 1] Generating script...');
    const script = await generateScript({
      topic,
      language: 'en',
      tone: 'engaging',
      length: 'short',
    });
    const scriptPath = join(outDir, 'script.txt');
    await fs.writeFile(scriptPath, script, 'utf8');
    console.log(`  ✓ Script generated (${script.length} chars) → ${scriptPath}\n`);

    // Step 2: Synthesize speech
    console.log('[STEP 2] Synthesizing speech...');
    const audioPath = await synthesizeSpeech(script, { language: 'en' });
    console.log(`  ✓ Audio synthesized → ${audioPath}\n`);

    // Step 3: Render video
    console.log('[STEP 3] Rendering video...');
    const outputVideo = join(outDir, 'output-phase1.mp4');
    const videoPath = await renderVideo({
      audio: audioPath,
      output: outputVideo,
      duration: 30,
      subtitles: [
        { text: 'Introducing AI Automation', startTime: 0, endTime: 5000 },
        { text: 'Learn the basics today', startTime: 5000, endTime: 15000 },
      ],
    });
    console.log(`  ✓ Video rendered → ${videoPath}\n`);

    // Verify output
    const stats = await fs.stat(videoPath);
    console.log('═══════════════════════════════════════════');
    console.log('  SUCCESS — Phase 1 Pipeline Complete');
    console.log('═══════════════════════════════════════════');
    console.log(`  Output: ${videoPath}`);
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('═══════════════════════════════════════════\n');

    return { success: true, videoPath };
  } catch (err: any) {
    console.error('\n❌ Phase 1 Pipeline FAILED');
    console.error('Error:', err.message || err);
    console.error('\nStack:', err.stack);
    process.exit(1);
  }
}

// Run if invoked directly
if (require.main === module) {
  testPhase1Pipeline().then(() => {
    console.log('Test completed successfully!');
    process.exit(0);
  }).catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

export { testPhase1Pipeline };
