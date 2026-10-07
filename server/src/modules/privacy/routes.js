import { Router } from 'express';
import Joi from 'joi';
import { config } from '../../config/index.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { REFRESH_COOKIE } from '../auth/controller.js';
import * as privacy from './service.js';

// /account: the user's own data-protection rights. Any signed-in user, any status.
const router = Router();

// Public: what the privacy page shows, from the same constants the retention job uses.
router.get('/privacy-info', (req, res) => {
  res.json({
    controller: config.dataControllerName,
    contactEmail: config.privacyContactEmail,
    retention: privacy.RETENTION,
    backupRetentionDays: privacy.BACKUP_RETENTION_DAYS,
  });
});

router.use(authenticate);

// Right of access: everything held about the user, as a JSON download.
router.get('/export', async (req, res) => {
  const data = await privacy.exportUserData(req.user.id, { ip: req.ip });
  res.attachment(`my-data-${new Date().toISOString().slice(0, 10)}.json`);
  res.json(data);
});

// Right to erasure: anonymises the account at once (see privacy/service.js).
const deleteSchema = Joi.object({
  password: Joi.string().max(128).allow(''),
  confirmEmail: Joi.string().trim().max(255).allow(''),
});
router.post('/delete', authLimiter, validate(deleteSchema), async (req, res) => {
  await privacy.deleteOwnAccount(req.user.id, req.body, { ip: req.ip });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.status(204).end();
});

export default router;
