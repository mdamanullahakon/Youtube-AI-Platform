const { Queue } = require('bullmq');
const IORedis = require('ioredis');

async function main() {
  const redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  const renderQ = new Queue('video-render', { connection: redis });
  const uploadQ = new Queue('youtube-upload', { connection: redis });

  try {
    const [rCounts, uCounts] = await Promise.all([
      renderQ.getJobCounts(),
      uploadQ.getJobCounts(),
    ]);

    console.log('=== VIDEO-RENDER QUEUE ===');
    console.log(JSON.stringify(rCounts, null, 2));

    console.log('\n=== YOUTUBE-UPLOAD QUEUE ===');
    console.log(JSON.stringify(uCounts, null, 2));

    // Get active jobs using getJobs
    console.log('\n=== ACTIVE RENDER JOBS ===');
    const activeJobs = (await renderQ.getJobs(['active'])).filter(Boolean);
    for (const j of activeJobs) {
      console.log(`  Job ${j.id}: name=${j.name}, data=${JSON.stringify(j.data).slice(0,100)}`);
    }

    // Get failed jobs
    console.log('\n=== FAILED RENDER JOBS (last 5) ===');
    const failedJobs = (await renderQ.getJobs(['failed'], 0, 5)).filter(Boolean);
    for (const j of failedJobs) {
      const reason = (j.failedReason || '').slice(0, 300);
      console.log(`  Job ${j.id}: name=${j.name}, reason=${reason}`);
    }

    // Check upload queue for jobs
    console.log('\n=== UPLOAD QUEUE JOBS ===');
    const uploadAll = (await uploadQ.getJobs(['waiting', 'active', 'completed', 'failed'], 0, 10)).filter(Boolean);
    for (const j of uploadAll) {
      const state = await j.getState().catch(() => 'unknown');
      console.log(`  Job ${j.id}: name=${j.name}, state=${state}, data=${JSON.stringify(j.data).slice(0,100)}`);
    }
  } finally {
    await renderQ.close();
    await uploadQ.close();
    await redis.quit();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
