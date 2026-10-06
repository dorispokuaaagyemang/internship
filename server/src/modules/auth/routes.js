import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { acceptInviteSchema, loginSchema, registerSchema, resendVerificationSchema } from './validators.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/refresh', authLimiter, controller.refresh);
router.post('/logout', controller.logout);
router.get('/me', authenticate, controller.me);
router.get('/google', authLimiter, controller.googleStart);
router.get('/google/callback', authLimiter, controller.googleCallback);
router.get('/verify-email/:token', controller.verifyEmail);
router.post('/verify-email/resend', authLimiter, validate(resendVerificationSchema), controller.resendVerification);

// US-09: staff invites (supervisors added by their company).
router.get('/invite/:token', authLimiter, controller.getInvite);
router.post('/invite/accept', authLimiter, validate(acceptInviteSchema), controller.acceptInvite);

export default router;
