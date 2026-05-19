import { getConfigValue } from './config.service';
import { getOAuth2Client, OAuthNotConfiguredError } from './youtube-oauth.service';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { logger } from '../utils/logger';

export interface TestResult {
  success: boolean;
  message: string;
  details?: string;
}

export async function testGeminiConnection(): Promise<TestResult> {
  const apiKey = await getConfigValue('GEMINI_API_KEY');
  if (!apiKey) {
    return { success: false, message: 'Gemini API key not configured' };
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: 'Reply with only the word: OK' }] }],
      },
      { timeout: 10000 }
    );

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return { success: true, message: 'Gemini API connection successful' };
    }
    return { success: false, message: 'Unexpected Gemini API response format' };
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 403) return { success: false, message: 'Invalid Gemini API key (403 Forbidden)' };
    if (status === 429) return { success: false, message: 'Rate limited. Try again later.' };
    return { success: false, message: `Gemini API error: ${error.message}` };
  }
}

export async function testSmtpConnection(): Promise<TestResult> {
  const host = await getConfigValue('SMTP_HOST');
  const user = await getConfigValue('SMTP_USER');
  const pass = await getConfigValue('SMTP_PASS');

  if (!host || !user || !pass) {
    const missing = [];
    if (!host) missing.push('SMTP_HOST');
    if (!user) missing.push('SMTP_USER');
    if (!pass) missing.push('SMTP_PASS');
    return { success: false, message: `SMTP not fully configured. Missing: ${missing.join(', ')}` };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    } as any);

    await transporter.verify();
    transporter.close();
    return { success: true, message: `SMTP connection to ${host} verified successfully` };
  } catch (error: any) {
    return { success: false, message: `SMTP connection failed: ${error.message}` };
  }
}

export async function testYouTubeConnection(): Promise<TestResult> {
  const refreshToken = await getConfigValue('YOUTUBE_REFRESH_TOKEN');

  try {
    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken || '' });

    if (!refreshToken) {
      return { success: false, message: 'YouTube OAuth client is configured but no refresh token saved. Complete OAuth flow to get one.' };
    }

    const { credentials } = await oauth2Client.refreshAccessToken();
    if (!credentials.access_token) {
      return { success: false, message: 'Failed to refresh YouTube access token' };
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (channel) {
      return {
        success: true,
        message: `Connected to channel: ${channel.snippet?.title || 'Unknown'}`,
        details: `Subscribers: ${channel.statistics?.subscriberCount || 'N/A'} | Videos: ${channel.statistics?.videoCount || 'N/A'}`,
      };
    }
    return { success: true, message: 'YouTube token refreshed successfully (no channel found)' };
  } catch (error: any) {
    if (error instanceof OAuthNotConfiguredError) {
      return { success: false, message: error.message };
    }
    if (error.message?.includes('invalid_grant')) {
      return { success: false, message: 'YouTube refresh token expired or revoked. Re-authenticate via OAuth.' };
    }
    return { success: false, message: `YouTube connection failed: ${error.message}` };
  }
}

export async function testTranscriptConnection(): Promise<TestResult> {
  const apiKey = await getConfigValue('TRANSCRIPT_API_KEY');
  if (!apiKey) {
    return { success: false, message: 'Transcript API key not configured' };
  }

  try {
    const response = await axios.get('https://transcriptapi.com/api/v1/health', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    if (response.status === 200) {
      return { success: true, message: 'Transcript API connection successful' };
    }
    return { success: false, message: `Transcript API responded with status ${response.status}` };
  } catch (error: any) {
    if (error.response?.status === 401) {
      return { success: false, message: 'Invalid Transcript API key (401 Unauthorized)' };
    }
    // If the health endpoint doesn't exist, try a simple auth check
    try {
      const testResponse = await axios.get('https://transcriptapi.com/api/v1/account', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      if (testResponse.status < 500) {
        return { success: true, message: 'Transcript API key is valid' };
      }
    } catch {}
    return { success: false, message: `Transcript API unreachable: ${error.message}` };
  }
}

const TEST_HANDLERS: Record<string, () => Promise<TestResult>> = {
  gemini: testGeminiConnection,
  smtp: testSmtpConnection,
  youtube: testYouTubeConnection,
  transcript: testTranscriptConnection,
};

export function getTestHandler(section: string): (() => Promise<TestResult>) | null {
  return TEST_HANDLERS[section] || null;
}

export const ASSISTANT_ANSWERS: Record<string, string> = {
  'gemini': (
    '**How to get a Gemini API Key:**\n\n' +
    '1. Go to https://aistudio.google.com/apikey\n' +
    '2. Sign in with your Google account\n' +
    '3. Click "Get API Key" → "Create API Key"\n' +
    '4. Copy the key and paste it into the Gemini section\n\n' +
    'The key starts with "AIza..." and is free to use with quota limits.'
  ),
  'youtube': (
    '**How to connect YouTube:**\n\n' +
    '1. Go to https://console.cloud.google.com\n' +
    '2. Create a project → Enable YouTube Data API v3\n' +
    '3. Go to Credentials → Create OAuth 2.0 Client ID\n' +
    '4. Set redirect URI to: http://localhost:4000/api/auth/youtube/callback\n' +
    '5. Copy CLIENT_ID and CLIENT_SECRET to your .env\n' +
    '6. Click "Connect YouTube" on the Settings page to get a refresh token'
  ),
  'smtp': (
    '**How to set up Gmail SMTP:**\n\n' +
    '1. Enable 2-Step Verification on your Google account\n' +
    '2. Go to https://myaccount.google.com/apppasswords\n' +
    '3. Generate an App Password for "Mail"\n' +
    '4. Use the 16-character password in the SMTP section\n\n' +
    'Settings:\n' +
    '- Host: smtp.gmail.com\n' +
    '- Port: 587\n' +
    '- Secure: false (STARTTLS)\n' +
    '- User: your full Gmail address'
  ),
  'transcript': (
    '**Transcript API Options:**\n\n' +
    '**Option 1: OpenAI Whisper (Recommended)**\n' +
    '- Get API key from: https://platform.openai.com/api-keys\n' +
    '- Uses the whisper-1 model\n\n' +
    '**Option 2: AssemblyAI**\n' +
    '- Sign up at: https://www.assemblyai.com\n' +
    '- Free tier includes 100 hours\n\n' +
    '**Option 3: YouTube Captions API**\n' +
    '- No API key needed for public video captions\n' +
    '- Only works if the video has captions enabled'
  ),
  'test-failed': (
    '**Troubleshooting failed connections:**\n\n' +
    '1. **API Key issues**: Double-check the key for typos (extra spaces, missing chars)\n' +
    '2. **Network issues**: Ensure your firewall/antivirus is not blocking the connection\n' +
    '3. **Rate limiting**: Some APIs limit requests per minute. Wait and retry.\n' +
    '4. **Expired tokens**: YouTube refresh tokens expire if unused for 6 months\n' +
    '5. **Wrong credentials**: SMTP passwords with special chars may need URL encoding'
  ),
  'default': (
    '**I can help you with:**\n\n' +
    '• Getting API keys for Gemini, YouTube, SMTP, or Transcript services\n' +
    '• Troubleshooting connection issues\n' +
    '• Understanding what each service does\n' +
    '• Step-by-step setup guidance\n\n' +
    'Try asking: "How do I get a Gemini API key?" or "Why is my SMTP not working?"'
  ),
};
