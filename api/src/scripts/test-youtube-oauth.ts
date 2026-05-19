import { getAuthenticatedClient, generateAuthUrl } from '../services/youtube-oauth.service';
import { prisma } from '../config/db';

const USER_ID = 'cmp8nn57b000dw8kcce6tmxrc';
const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';

async function main() {
  console.log('TESTING YOUTUBE OAUTH');
  console.log('User:', USER_ID);
  console.log('Channel:', CHANNEL_ID);

  console.log('\nTest 1: getAuthenticatedClient()');
  try {
    const client = await getAuthenticatedClient(USER_ID, CHANNEL_ID);
    const token = await client.getAccessToken();
    console.log('OAuth OK - Token:', token?.token ? token.token.substring(0, 20) + '...' : 'NONE');
  } catch (err: any) {
    console.log('OAuth FAILED:', err.message);
    if (err.message.includes('reconnect') || err.message.includes('expired') || err.message.includes('refresh')) {
      console.log('Token needs refresh - generating auth URL');
      try {
        const authUrl = await generateAuthUrl(USER_ID);
        console.log('Auth URL:', authUrl.authUrl);
      } catch (e2: any) {
        console.log('Auth URL generation failed:', e2.message);
      }
    }
  }

  await (prisma as any).$disconnect();
}

main().catch(async (e) => {
  console.error('FAILED:', e);
  await (prisma as any).$disconnect();
});
