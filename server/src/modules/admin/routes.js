import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as companies from '../companies/controller.js';
import { listCompaniesQuery } from '../companies/validators.js';

// Every /admin route is admin-only. The business rules stay in each domain's service,
// and mutations are audited there (US-12).
const router = Router();

router.use(authenticate, authorize('admin'));

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new AppError(404, 'NOT_FOUND', 'Not found'));
  next();
});

router.get('/companies', validate(listCompaniesQuery, 'query'), companies.list);
router.post('/companies/:id/approve', companies.approve);

export default router;
