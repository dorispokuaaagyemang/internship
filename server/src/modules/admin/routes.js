import { Router } from 'express';
import Joi from 'joi';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import { ROLES, USER_STATUSES } from '../../db/models/user.js';
import * as companies from '../companies/controller.js';
import * as companyService from '../companies/service.js';
import { listCompaniesQuery } from '../companies/validators.js';
import * as admin from './service.js';

// Every /admin route is admin-only (US-12). Each change is audited in its service.
const router = Router();
const id = (req) => Number(req.params.id);

const paging = {
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};
const usersQuery = Joi.object({
  q: Joi.string().trim().max(100).allow(''),
  role: Joi.string().valid(...ROLES),
  status: Joi.string().valid(...USER_STATUSES),
  ...paging,
});
const auditQuery = Joi.object({
  // An exact action ("admin.user_suspended") or a prefix ending in a dot ("auth.").
  action: Joi.string().trim().max(64).allow(''),
  actorId: Joi.number().integer().positive(),
  entityType: Joi.string().trim().max(64),
  entityId: Joi.number().integer().positive(),
  from: Joi.date().iso(),
  to: Joi.date().iso().min(Joi.ref('from')),
  ...paging,
});
const reasonSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Give a reason; it is kept in the audit log',
    'string.empty': 'Give a reason; it is kept in the audit log',
    'string.min': 'Give a reason; it is kept in the audit log',
  }),
});

router.use(authenticate, authorize('admin'));

router.param('id', (req, res, next, value) => {
  if (!/^\d+$/.test(value)) return next(new AppError(404, 'NOT_FOUND', 'Not found'));
  next();
});

// US-12: dashboard counts.
router.get('/stats', async (req, res) => {
  res.json({ stats: await admin.getStats() });
});

// US-04, US-12: companies.
router.get('/companies', validate(listCompaniesQuery, 'query'), companies.list);
router.post('/companies/:id/approve', companies.approve);
router.post('/companies/:id/suspend', validate(reasonSchema), async (req, res) => {
  res.json({ company: await companyService.suspendCompany(req.user, id(req), req.body, { ip: req.ip }) });
});
router.post('/companies/:id/reinstate', async (req, res) => {
  res.json({ company: await companyService.reinstateCompany(req.user, id(req), { ip: req.ip }) });
});

// US-12: users.
router.get('/users', validate(usersQuery, 'query'), async (req, res) => {
  res.json(await admin.listUsers(req.query));
});
router.post('/users/:id/suspend', validate(reasonSchema), async (req, res) => {
  res.json({ user: await admin.suspendUser(req.user, id(req), req.body, { ip: req.ip }) });
});
router.post('/users/:id/reinstate', async (req, res) => {
  res.json({ user: await admin.reinstateUser(req.user, id(req), { ip: req.ip }) });
});
router.delete('/users/:id', validate(reasonSchema), async (req, res) => {
  await admin.deleteUser(req.user, id(req), req.body, { ip: req.ip });
  res.status(204).end();
});

// US-12: the audit trail.
router.get('/audit-logs', validate(auditQuery, 'query'), async (req, res) => {
  res.json(await admin.listAuditLogs(req.query));
});

export default router;
