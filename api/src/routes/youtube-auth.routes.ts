import { Router } from 'express';
import {
  connectYouTube,
  youtubeCallback,
  getChannels,
  disconnectYouTube,
  refreshToken,
  oauthStatus,
  setActiveChannel,
  getActiveChannel,
  revokeChannel,
  refreshAllTokens,
  getReconnectNeeded,
} from '../controllers/youtube-auth.controller';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { accountIdParams } from '../validators';

const router = Router();

router.get('/connect', authenticate, connectYouTube);
router.get('/callback', youtubeCallback);
router.get('/channels', authenticate, getChannels);
router.get('/status', optionalAuth, oauthStatus);
router.get('/reconnect-needed', authenticate, getReconnectNeeded);
router.get('/active', authenticate, getActiveChannel);
router.put('/active/:accountId', authenticate, validateParams(accountIdParams), setActiveChannel);
router.post('/disconnect/:accountId', authenticate, validateParams(accountIdParams), disconnectYouTube);
router.post('/revoke/:accountId', authenticate, validateParams(accountIdParams), revokeChannel);
router.post('/refresh/:accountId', authenticate, validateParams(accountIdParams), refreshToken);
router.post('/refresh-all', authenticate, refreshAllTokens);

export default router;
