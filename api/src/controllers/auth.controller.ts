import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { apiLogger } from '../utils/logger';
import { sendPasswordResetEmail } from '../services/email.service';
import { registerSchema, loginSchema, updateSettingsSchema } from '../validators';
import type { AuthRequest } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/encryption';
import {
  generateTokenPair,
  generateAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
  blacklistToken,
  isTokenBlacklisted,
  createSession,
  removeSession,
  getUserSessions,
  invalidateAllUserSessions,
  rotateRefreshToken,
  recordFailedLoginAttempt,
  isAccountLocked,
  clearLoginAttempts,
  detectSuspiciousLogin,
} from '../services/auth.service';

function setTokenCookie(res: Response, token: string, maxAgeMs: number) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    maxAge: maxAgeMs,
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
  });
}

function clearTokenCookie(res: Response) {
  res.clearCookie('token', {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
  });
}

export async function register(req: Request, res: Response) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map(e => e.message),
      });
    }

    const { email, password, name } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    await Promise.all([
      prisma.settings.create({ data: { userId: user.id } }),
      prisma.subscription.create({ data: { userId: user.id } }),
    ]);

    const { token, refreshToken, expiresAt } = generateTokenPair(user.id, user.role);
    const decoded = verifyAccessToken(token);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await createSession(user.id, decoded.jti, token, ip, userAgent);

    setTokenCookie(res, token, expiresAt.getTime() - Date.now());

    apiLogger.info(`User registered: ${email}`, { userId: user.id, ip: req.ip });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        refreshToken,
        expiresAt,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
      token,
      refreshToken,
      expiresAt,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error: any) {
    apiLogger.error('Registration failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map(e => e.message),
      });
    }

    const { email, password } = parsed.data;

    apiLogger.info('Login request received', {
      email,
      bodyKeys: Object.keys(req.body),
      contentType: req.headers['content-type'],
    });

    const lockStatus = await isAccountLocked(email);
    if (lockStatus.locked) {
      apiLogger.warn('Login blocked - account locked', { email });
      return res.status(429).json({
        success: false,
        message: 'Account temporarily locked due to too many failed attempts',
        retryAfter: Math.ceil(lockStatus.remainingMs / 1000),
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      apiLogger.warn('Login failed - user not found', { email });
      await recordFailedLoginAttempt(email, req.ip || 'unknown');
      return res.status(401).json({ success: false, message: 'No account found with this email' });
    }

    apiLogger.info('User found in DB', { email, userId: user.id });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      apiLogger.warn('Login failed - wrong password', { email, userId: user.id });
      await recordFailedLoginAttempt(email, req.ip || 'unknown');
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    apiLogger.info('Password verified successfully', { email, userId: user.id });

    await clearLoginAttempts(email);

    const { token, refreshToken, expiresAt } = generateTokenPair(user.id, user.role);
    const decoded = verifyAccessToken(token);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    await createSession(user.id, decoded.jti, token, ip, userAgent);

    const suspicious = await detectSuspiciousLogin(user.id, email, { ip, userAgent });
    if (suspicious.suspicious) {
      apiLogger.warn(`Suspicious login for ${email}`, { reason: suspicious.reason, ip, userAgent });
    }

    setTokenCookie(res, token, expiresAt.getTime() - Date.now());

    apiLogger.info(`User logged in: ${email}`, { userId: user.id, ip });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        refreshToken,
        expiresAt,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
      token,
      refreshToken,
      expiresAt,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error: any) {
    apiLogger.error('Login failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Login failed' });
  }
}

export async function refreshTokenHandler(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const tokenBlacklisted = await isTokenBlacklisted(refreshToken);
    if (tokenBlacklisted) {
      return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const { tokenPair, oldJti } = await rotateRefreshToken(refreshToken, user.id, user.role);

    const decoded = verifyAccessToken(tokenPair.token);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await createSession(user.id, decoded.jti, tokenPair.token, ip, userAgent);

    setTokenCookie(res, tokenPair.token, tokenPair.expiresAt.getTime() - Date.now());

    apiLogger.info(`Token refreshed for user: ${user.id}`, { userId: user.id, ip });

    res.json({
      success: true,
      message: 'Token refreshed',
      data: {
        token: tokenPair.token,
        refreshToken: tokenPair.refreshToken,
        expiresAt: tokenPair.expiresAt,
      },
      token: tokenPair.token,
      refreshToken: tokenPair.refreshToken,
      expiresAt: tokenPair.expiresAt,
    });
  } catch (error: any) {
    apiLogger.error('Refresh token failed', { error: error.message });
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
}

export async function logout(req: AuthRequest, res: Response) {
  try {
    const { refreshToken } = req.body;
    const userId = req.userId;
    const tokenJti = req.tokenJti;

    if (tokenJti && userId) {
      await removeSession(userId, tokenJti);
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const accessToken = authHeader.slice(7);
      try {
        const decoded = jwt.decode(accessToken) as JwtPayload | null;
        const exp = decoded?.exp;
        const ttl = exp ? exp * 1000 - Date.now() : 15 * 60 * 1000;
        if (ttl > 0) {
          await blacklistToken(accessToken, ttl);
        }
      } catch {}
    }

    if (refreshToken) {
      try {
        const decoded = jwt.decode(refreshToken) as JwtPayload | null;
        const exp = decoded?.exp;
        const ttl = exp ? exp * 1000 - Date.now() : 7 * 86400 * 1000;
        if (ttl > 0) {
          await blacklistToken(refreshToken, ttl);
        }
      } catch {}
    }

    clearTokenCookie(res);

    apiLogger.info(`User logged out: ${req.userId}`);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error: any) {
    apiLogger.error('Logout failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
}

export async function logoutAll(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    await invalidateAllUserSessions(userId);

    clearTokenCookie(res);

    apiLogger.info(`User logged out of all devices: ${userId}`);
    res.json({ success: true, message: 'Logged out of all devices successfully' });
  } catch (error: any) {
    apiLogger.error('Logout all failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to logout all devices' });
  }
}

export async function getSessions(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const sessions = await getUserSessions(userId);
    const currentJti = req.tokenJti;

    const result = sessions.map(s => ({
      id: s.jti,
      isCurrent: s.jti === currentJti,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      ip: s.ip,
      userAgent: s.userAgent,
    }));

    res.json({ success: true, sessions: result, count: result.length });
  } catch (error: any) {
    apiLogger.error('Get sessions failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get sessions' });
  }
}

export async function revokeSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId;
    const sessionJti = req.params.jti as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!sessionJti) {
      return res.status(400).json({ success: false, message: 'Session JTI is required' });
    }

    if (sessionJti === req.tokenJti) {
      return res.status(400).json({ success: false, message: 'Cannot revoke current session. Use /logout instead.' });
    }

    await removeSession(userId, sessionJti);

    apiLogger.info(`Session revoked: ${sessionJti} for user: ${userId}`);
    res.json({ success: true, message: 'Session revoked successfully' });
  } catch (error: any) {
    apiLogger.error('Revoke session failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to revoke session' });
  }
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ success: true, message: 'If the email exists, a reset link has been sent' });
    }

    const resetToken = jwt.sign(
      { userId: user.id, type: 'password-reset', jti: uuidv4() },
      env.JWT_SECRET,
      { expiresIn: '1h', issuer: env.JWT_ISSUER },
    );

    await sendPasswordResetEmail(email, resetToken);

    apiLogger.info(`Password reset email sent to: ${email}`);
    res.json({ success: true, message: 'If the email exists, a reset link has been sent' });
  } catch (error: any) {
    apiLogger.error('Forgot password failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    let decoded: { userId: string; type: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET, { issuer: env.JWT_ISSUER }) as { userId: string; type: string };
      if (decoded.type !== 'password-reset') {
        return res.status(400).json({ success: false, message: 'Invalid reset token' });
      }
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { password: hashedPassword },
    });

    await invalidateAllUserSessions(decoded.userId);

    apiLogger.info(`Password reset completed for user: ${decoded.userId}`);
    res.json({ success: true, message: 'Password reset successfully. Please log in again.' });
  } catch (error: any) {
    apiLogger.error('Reset password failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
}

async function ensureUser(userId: string): Promise<{ id: string; email: string; name: string | null; avatar: string | null; role: string }> {
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar, role: user.role };
  }

  apiLogger.warn('User not found for valid token — auto-recreating fallback user', { userId });

  const fallbackEmail = `user-${userId.slice(0, 8)}@recovered.local`;
  user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: fallbackEmail,
      password: 'recovered_' + Math.random().toString(36).slice(2),
      name: 'Recovered User',
    },
  });

  await Promise.allSettled([
    prisma.settings.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
    prisma.subscription.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
  ]);

  return { id: user.id, email: user.email, name: user.name, avatar: user.avatar, role: user.role };
}

export async function getProfile(req: AuthRequest, res: Response) {
  if (!req.userId) {
    return res.status(404).json({ success: false, message: 'Profile not found' });
  }
  try {
    apiLogger.info('Get profile called', { userId: req.userId, path: req.path, hasToken: !!req.token });

    const user = await ensureUser(req.userId!);

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true, settings: true },
    });

    let geminiKey: string | null = null;
    let youtubeApiKey: string | null = null;

    if (fullUser?.settings?.geminiKey) {
      try { geminiKey = decrypt(fullUser.settings.geminiKey); } catch { geminiKey = fullUser.settings.geminiKey; }
    }
    if (fullUser?.settings?.youtubeApiKey) {
      try { youtubeApiKey = decrypt(fullUser.settings.youtubeApiKey); } catch { youtubeApiKey = fullUser.settings.youtubeApiKey; }
    }

    const userObj = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      subscription: {
        plan: fullUser?.subscription?.plan || 'free',
        status: fullUser?.subscription?.status || 'active',
        videoLimit: fullUser?.subscription?.videoLimit || 10,
        videosUsed: fullUser?.subscription?.videosUsed || 0,
        renewsAt: fullUser?.subscription?.renewsAt,
      },
      settings: {
        preferredModel: fullUser?.settings?.preferredModel || 'ollama',
        geminiKey,
        youtubeApiKey,
      },
    };

    apiLogger.info('Get profile success', { userId: user.id, email: user.email });

    res.json({
      success: true,
      message: 'Profile retrieved',
      data: userObj,
      user: userObj,
      token: req.token,
    });
  } catch (error: any) {
    apiLogger.error('Get profile failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
}

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const { name, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { ...(name !== undefined && { name }), ...(avatar !== undefined && { avatar }) },
    });

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
    });
  } catch (error: any) {
    apiLogger.error('Update profile failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
}

export async function updateSettings(req: AuthRequest, res: Response) {
  try {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map(e => e.message),
      });
    }
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const data: any = {};
    if (parsed.data.geminiKey !== undefined) {
      data.geminiKey = parsed.data.geminiKey ? encrypt(parsed.data.geminiKey) : null;
    }
    if (parsed.data.youtubeApiKey !== undefined) {
      data.youtubeApiKey = parsed.data.youtubeApiKey ? encrypt(parsed.data.youtubeApiKey) : null;
    }
    if (parsed.data.preferredModel !== undefined) {
      data.preferredModel = parsed.data.preferredModel;
    }

    const settings = await prisma.settings.upsert({
      where: { userId: req.userId },
      update: data,
      create: { userId: req.userId, ...data },
    });

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    apiLogger.error('Update settings failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
}
