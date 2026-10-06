import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as controller from './controller.js';
import { myApplicationsQuery, statusChangeSchema } from './validators.js';

// /applications. Applying and a posting's applicant list live under /postings/:id.
const router = Router();

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found'));
  next();
});

router.use(authenticate);

router.get('/me', authorize('student'), validate(myApplicationsQuery, 'query'), controller.listMine);
// The student who applied, or a rep of the posting's company (checked in the service).
router.get('/:id', authorize('student', 'company_rep'), controller.get);
router.post('/:id/withdraw', authorize('student'), controller.withdraw);
router.patch('/:id/status', authorize('company_rep'), validate(statusChangeSchema), controller.changeStatus);
router.get('/:id/resume', authorize('company_rep'), controller.getResume);

export default router;
