import { Router } from 'express';
import { authenticate, authorize, optionalAuthenticate, requireVerified } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as controller from './controller.js';
import * as applications from '../applications/controller.js';
import { applicantsQuery, applySchema } from '../applications/validators.js';
import { postingSchema, searchQuery } from './validators.js';

const router = Router();

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new AppError(404, 'POSTING_NOT_FOUND', 'Posting not found'));
  next();
});

// US-03: anyone can search and read open postings; a rep also sees their own drafts.
router.get('/', validate(searchQuery, 'query'), controller.search);
router.get('/:id', optionalAuthenticate, controller.get);

// US-05: a verified rep of a verified company (checked in the service: assertCanPost).
const rep = [authenticate, authorize('company_rep'), requireVerified];
router.post('/', ...rep, validate(postingSchema), controller.create);
router.put('/:id', ...rep, validate(postingSchema), controller.update);
router.post('/:id/publish', ...rep, controller.publish);
router.post('/:id/close', ...rep, controller.close);

// US-03: a verified student (phone checked by requireVerified, profile by the service).
router.post('/:id/apply', authenticate, authorize('student'), requireVerified, validate(applySchema), applications.apply);
// US-06: the posting's company only (checked in the service).
router.get('/:id/applications', authenticate, authorize('company_rep'), validate(applicantsQuery, 'query'), applications.listForPosting);

export default router;
