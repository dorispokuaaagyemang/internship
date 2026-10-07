import { Router } from 'express';
import health from './modules/health/routes.js';
import auth from './modules/auth/routes.js';
import students from './modules/students/routes.js';
import companies from './modules/companies/routes.js';
import admin from './modules/admin/routes.js';
import postings from './modules/postings/routes.js';
import applications from './modules/applications/routes.js';
import notifications from './modules/notifications/routes.js';
import { apiLimiter } from './middleware/rate-limit.js';
import internships from './modules/internships/routes.js';

const router = Router();

router.use('/health', health);
// Everything below counts towards the per-IP limit; the health check (Docker, monitoring) does not.
router.use(apiLimiter);
router.use('/auth', auth);
router.use('/students', students);
router.use('/companies', companies);
router.use('/admin', admin);
router.use('/postings', postings);
router.use('/applications', applications);
router.use('/notifications', notifications);
router.use('/internships', internships);

export default router;
