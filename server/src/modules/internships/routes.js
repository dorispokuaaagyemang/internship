import { Router } from 'express';
import { authenticate, authorize, requireVerified } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as internships from './service.js';
import { assignSchema, datesSchema, evaluationSchema, listQuery } from './validators.js';

// /internships (US-09..US-11). Access to each internship is checked in the service.
const router = Router();
const id = (req) => Number(req.params.id);

router.param('id', (req, res, next, value) => {
  if (!/^\d+$/.test(value)) return next(new AppError(404, 'INTERNSHIP_NOT_FOUND', 'Internship not found'));
  next();
});

router.use(authenticate);

// A student's own, a company's, or a supervisor's current interns (all for an admin).
router.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await internships.listInternships(req.user, req.query));
});

router.get('/:id', async (req, res) => {
  res.json({ internship: await internships.getInternship(id(req), req.user) });
});

router.patch('/:id/dates', authorize('company_rep'), requireVerified, validate(datesSchema), async (req, res) => {
  res.json({ internship: await internships.updateDates(req.user.id, id(req), req.body) });
});

// US-09
router.post('/:id/supervisor', authorize('company_rep'), requireVerified, validate(assignSchema), async (req, res) => {
  res.json({ internship: await internships.assignSupervisor(req.user.id, id(req), req.body, { ip: req.ip }) });
});

// US-10
router.get('/:id/evaluations', async (req, res) => {
  res.json({ items: await internships.listEvaluations(id(req), req.user) });
});

router.post('/:id/evaluations', authorize('supervisor'), requireVerified, validate(evaluationSchema), async (req, res) => {
  res.status(201).json({ evaluation: await internships.createEvaluation(id(req), req.user, req.body) });
});

// US-11: the supervisor (or an admin) confirms completion; the certificate follows from the worker.
router.post('/:id/complete', authorize('supervisor', 'admin'), requireVerified, async (req, res) => {
  res.status(202).json({ internship: await internships.completeInternship(id(req), req.user, { ip: req.ip }) });
});

router.get('/:id/certificate', async (req, res) => {
  res.json(await internships.getCertificateDownload(id(req), req.user));
});

router.get('/:id/resume', authorize('company_rep', 'supervisor', 'admin'), async (req, res) => {
  res.json(await internships.getInternResume(id(req), req.user));
});

export default router;
