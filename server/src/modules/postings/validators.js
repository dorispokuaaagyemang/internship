import Joi from 'joi';
import { POSTING_STATUSES } from '../../db/models/posting.js';

const text = (label, max) =>
  Joi.string()
    .trim()
    .max(max)
    .required()
    .messages({
      'any.required': `${label} is required`,
      'string.empty': `${label} is required`,
      'string.max': `${label} must be at most ${max} characters`,
    });

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// US-05: title, description, duration, stipend and required skills, plus where, what field,
// and until when students can apply. Create and update both send the whole posting.
export const postingSchema = Joi.object({
  title: text('Title', 150),
  description: text('Description', 10_000),
  location: text('Location', 100),
  domain: text('Domain', 80),
  durationWeeks: Joi.number().integer().min(1).max(104).required().messages({
    'any.required': 'Duration is required',
    'number.base': 'Duration must be a number of weeks',
    'number.min': 'Duration must be between 1 and 104 weeks',
    'number.max': 'Duration must be between 1 and 104 weeks',
  }),
  stipend: Joi.number().min(0).max(10_000_000).precision(2).required().messages({
    'any.required': 'Stipend is required (0 for unpaid)',
    'number.base': 'Stipend must be a number',
    'number.min': 'Stipend cannot be negative',
  }),
  stipendCurrency: Joi.string().trim().uppercase().length(3).pattern(/^[A-Z]{3}$/).default('KES').messages({
    'string.length': 'Use a 3-letter currency code, e.g. KES',
    'string.pattern.base': 'Use a 3-letter currency code, e.g. KES',
  }),
  deadline: Joi.date()
    .iso()
    .greater('now')
    .custom((value, helpers) => (value.getTime() - Date.now() > YEAR_MS ? helpers.error('date.tooFar') : value))
    .required()
    .messages({
      'any.required': 'Application deadline is required',
      'date.base': 'Enter the deadline as a date',
      'date.format': 'Enter the deadline as a date',
      'date.greater': 'The deadline must be in the future',
      'date.tooFar': 'The deadline must be within a year',
    }),
  skills: Joi.array()
    .items(Joi.string().trim().replace(/\s+/g, ' ').min(1).max(50))
    .min(1)
    .max(20)
    .required()
    .messages({
      'any.required': 'List at least one required skill',
      'array.min': 'List at least one required skill',
      'array.max': 'List at most 20 skills',
    }),
});

const paging = {
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
};

// US-03: keyword, location, domain.
export const searchQuery = Joi.object({
  q: Joi.string().trim().max(100).allow(''),
  location: Joi.string().trim().max(100).allow(''),
  domain: Joi.string().trim().max(80).allow(''),
  ...paging,
});

export const myPostingsQuery = Joi.object({
  status: Joi.string().valid(...POSTING_STATUSES),
  ...paging,
});
