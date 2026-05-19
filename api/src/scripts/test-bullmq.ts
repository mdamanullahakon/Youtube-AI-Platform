import '../config/redis';  // patch runs first
import { Queue } from 'bullmq';

async function main() {
  console.log('Testing BullMQ Queue creation...');
  try {
    const q = new Queue('test-queue', {
      connection: { host: 'localhost', port: 6379 },
    });
    console.log('Queue created OK');
    await q.close();
    console.log('Queue closed');
  } catch (err: any) {
    console.error('Queue creation FAILED:', err.message);
  }
}
main();
