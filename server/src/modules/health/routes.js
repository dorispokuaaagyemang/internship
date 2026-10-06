import { Router } from 'express';
import { getHealth } from './service.js';

const router = Router();

router.get('/', async (req, res) => {
  const health = await getHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

export default router;
