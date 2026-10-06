import { Router } from 'express';
import { authenticate, authorize, requireVerified } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as controller from './controller.js';
import * as postings from '../postings/controller.js';
import { myPostingsQuery } from '../postings/validators.js';
import { addStaffSchema, registerCompanySchema } from './validators.js';

const router = Router();

router.use(authenticate, authorize('company_rep'));

router.param('userId', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found'));
  next();
});

// US-04: the rep's account must be active (email verified, for a password account).
router.post('/', requireVerified, validate(registerCompanySchema), controller.register);
router.get('/me', controller.getMine);
// US-05: every posting of the rep's company, drafts included.
router.get('/me/postings', validate(myPostingsQuery, 'query'), postings.listMine);

// US-09: the company's staff; supervisors are invited by email.
router.get('/me/staff', controller.listStaff);
router.post('/me/staff', requireVerified, validate(addStaffSchema), controller.addStaff);
router.post('/me/staff/:userId/invite', requireVerified, controller.resendInvite);

export default router;
