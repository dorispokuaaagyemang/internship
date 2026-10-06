import Joi from 'joi';
import { APPLICATION_STATUSES } from '../../db/models/application.js';
import { isValidISODate } from '../../lib/dates.js';

// 'YYYY-MM-DD', a real calendar date.
export const isoDate = Joi.string()
  .trim()
  .custom((value, helpers) => (isValidISODate(value) ? value : helpers.error('date.isoDay')))
  .messages({ 'date.isoDay': 'Enter a date as YYYY-MM-DD' });

const paging = {
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
};

// US-03
export const applySchema = Joi.object({
  coverLetter: Joi.string().trim().max(5000).allow('', null).empty('').default(null),
});

// US-06: the statuses a company can set. Withdrawn is the student's move.
export const statusChangeSchema = Joi.object({
  status: Joi.string().valid('shortlisted', 'interviewed', 'accepted', 'rejected').required().messages({
    'any.only': 'Status must be shortlisted, interviewed, accepted or rejected',
    'any.required': 'Status is required',
  }),
  note: Joi.string().trim().max(500).allow('', null).empty('').default(null),
  // US-09: when accepting, the internship's first day (default today).
  startDate: isoDate.when('status', { is: 'accepted', then: Joi.optional(), otherwise: Joi.forbidden() }).messages({
    'any.unknown': 'A start date is only given when accepting',
  }),
});

export const myApplicationsQuery = Joi.object({
  status: Joi.string().valid(...APPLICATION_STATUSES),
  ...paging,
});

// US-06: ?skills=SQL,Excel&university=Nairobi&minGpa=3
export const applicantsQuery = Joi.object({
  status: Joi.string().valid(...APPLICATION_STATUSES),
  skills: Joi.array()
    .items(Joi.string().trim().min(1).max(50))
    .max(10)
    .single()
    .custom((list) => list.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)),
  university: Joi.string().trim().max(150).allow(''),
  minGpa: Joi.number().min(0).max(5),
  ...paging,
});
