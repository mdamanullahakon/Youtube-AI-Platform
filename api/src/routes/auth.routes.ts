import { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import {
  register,
  login,
  refreshTokenHandler,
  logout,
  logoutAll,
  getSessions,
  revokeSession,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  updateSettings,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate, validateParams } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  updateSettingsSchema,
  jtiParam,
} from '../validators';
import { apiLogger } from '../utils/logger';

const router = Router();

function logAuthRequest(req: Request, _res: Response, next: NextFunction) {
  apiLogger.info(`Auth request: ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    ip: req.ip,
    hasAuth: !!req.headers.authorization,
    hasCookie: !!req.cookies?.token,
    contentType: req.headers['content-type'],
  });
  next();
}

router.use(logAuthRequest);

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshTokenSchema), refreshTokenHandler);
router.post('/logout', authenticate, logout);
router.post('/logout-all', authenticate, logoutAll);
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/:jti', authenticate, validateParams(jtiParam), revokeSession);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.get('/profile', authenticate, getProfile);
router.get('/me', authenticate, getProfile);
router.put('/profile', authenticate, validate(updateProfileSchema), updateProfile);
router.put('/settings', authenticate, validate(updateSettingsSchema), updateSettings);

export default router;
