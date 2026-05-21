const IORedis = require('ioredis');
const { Queue } = require('bullmq');

async function main() {
  const redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  const q = new Queue('video-render', { connection: redis });

  const job = await q.add('render-video', {
    projectId: 'cmpd3whi4000bw80wvz0zvabs'
  });

  console.log(`Render job ${job.id} added for project cmpd3whi4000bw80wvz0zvabs`);
  await q.close();
  await redis.quit();
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
