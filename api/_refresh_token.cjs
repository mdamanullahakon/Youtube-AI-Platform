const { PrismaClient } = require('@prisma/client');

async function main() {
  const p = new PrismaClient();
  const account = await p.youTubeAccount.findFirst({ where: { isConnected: true } });
  if (!account) {
    console.log('No connected YouTube account found');
    await p.$disconnect();
    return;
  }
  console.log(`Found account: ${account.channelTitle} (${account.channelId})`);
  console.log(`Token expires at: ${account.tokenExpiresAt}`);
  console.log(`Current time: ${new Date().toISOString()}`);
  console.log(`Token expired: ${Date.now() >= account.tokenExpiresAt.getTime()}`);

  // Use the refresh channel token flow directly
  const { google } = require('googleapis');
  const crypto = require('crypto');

  // Decrypt function (simplified)
  function decrypt(encrypted) {
    if (!encrypted || encrypted === 'd') return '';
    try {
      const [ivHex, tag, encryptedData] = encrypted.split(':');
      if (!ivHex || typeof tag !== 'string' || !encryptedData) return encrypted;
      const key = crypto.createHash('sha256').update('yt-ai-encryption-key-min-32-chars-long!!!').digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      return decipher.update(encryptedData, 'hex', 'utf8') + decipher.final('utf8');
    } catch { return encrypted; }
  }

  const refreshToken = decrypt(account.refreshToken);
  console.log(`Refresh token present: ${!!refreshToken}`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4000/api/auth/youtube/callback',
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const result = await oauth2Client.refreshAccessToken();
    const creds = result.credentials;
    console.log(`New access token expires at: ${new Date(creds.expiry_date).toISOString()}`);
    console.log(`✅ Token refreshed successfully!`);

    const newRefreshToken = creds.refresh_token || account.refreshToken;

    await p.youTubeAccount.update({
      where: { id: account.id },
      data: {
        accessToken: creds.access_token,
        refreshToken: newRefreshToken,
        tokenExpiresAt: new Date(creds.expiry_date || Date.now() + 3600000),
        lastSyncedAt: new Date(),
      },
    });
    console.log('✅ Token saved to database');
  } catch (err) {
    console.error(`❌ Token refresh failed: ${err.message}`);
  }

  await p.$disconnect();
}

main().catch(console.error);
