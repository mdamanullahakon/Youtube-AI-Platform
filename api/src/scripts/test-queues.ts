import '../config/redis';
import { INCOME_QUEUE_NAMES, incomeQueues, closeAllIncomeQueues } from '../services/income-system-v2/income.queue';

async function main() {
  console.log('Testing all income queues...');
  const names = Object.values(incomeQueues).map(q => q.name);
  console.log('Queues:', names.join(', '));
  console.log('INCOME_QUEUE_NAMES:', INCOME_QUEUE_NAMES.join(', '));

  // Check queues are initialized
  for (const [key, q] of Object.entries(incomeQueues)) {
    try {
      const client = await q.client;
      const ping = await client.ping();
      console.log(`  ${key}: OK (ping: ${ping})`);
    } catch (err: any) {
      console.log(`  ${key}: FAIL - ${err.message}`);
    }
  }

  await closeAllIncomeQueues();
  console.log('\nAll queues closed');
}
main().catch(console.error);
