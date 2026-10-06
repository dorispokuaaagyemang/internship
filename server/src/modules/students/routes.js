import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { singleFile } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { RESUME_MAX_BYTES } from './service.js';
import { profileSchema } from './validators.js';

const router = Router();

// A pending student may already fill in their profile; applying is what needs requireVerified.
router.use(authenticate, authorize('student'));

router.get('/me', controller.getMe);
router.put('/me', validate(profileSchema), controller.updateMe);

// US-02: multipart/form-data with the file in the `resume` field.
router.post('/me/resume', singleFile('resume', { maxBytes: RESUME_MAX_BYTES, label: 'resume' }), controller.uploadResume);
router.get('/me/resume', controller.getResume);
router.delete('/me/resume', controller.deleteResume);

export default router;
