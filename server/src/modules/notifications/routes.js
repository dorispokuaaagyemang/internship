import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as notifications from './service.js';

// US-07: the in-app list behind the bell. Every signed-in user has one.
const router = Router();

const listQuery = Joi.object({
  unread: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found'));
  next();
});

router.use(authenticate);

router.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await notifications.list(req.user.id, req.query));
});

router.patch('/:id/read', async (req, res) => {
  res.json({ notification: await notifications.markRead(req.user.id, Number(req.params.id)) });
});

router.post('/read-all', async (req, res) => {
  res.json(await notifications.markAllRead(req.user.id));
});

export default router;
