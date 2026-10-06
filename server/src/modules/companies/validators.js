import Joi from 'joi';
import { COMPANY_STATUSES } from '../../db/models/company.js';
import { phone } from '../auth/validators.js';

// US-04. The contact number defaults to the rep's own; a Google account has none, so it must send one.
export const registerCompanySchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required().messages({
    'any.required': 'Company name is required',
    'string.empty': 'Company name is required',
  }),
  // Stored upper-case with single spaces, so "pvt-123 45" and "PVT-123  45" are one company.
  regNumber: Joi.string()
    .trim()
    .uppercase()
    .replace(/\s+/g, ' ')
    .pattern(/^[A-Z0-9][A-Z0-9 ./-]{1,49}$/)
    .required()
    .messages({
      'any.required': 'Registration number is required',
      'string.empty': 'Registration number is required',
      'string.pattern.base': 'Use letters, digits, spaces, dots, dashes or slashes (2-50 characters)',
    }),
  contactPhone: phone,
  website: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(255).allow('', null).empty('').default(null).messages({
    'string.uri': 'Enter a full web address, e.g. https://example.com',
  }),
});

// US-09: a rep adds a supervisor by name and email.
export const addStaffSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required().messages({
    'any.required': 'Full name is required',
    'string.empty': 'Full name is required',
  }),
  email: Joi.string().trim().lowercase().email().max(255).required().messages({
    'any.required': 'Email is required',
    'string.empty': 'Email is required',
    'string.email': 'Enter a valid email address',
  }),
});

export const listCompaniesQuery = Joi.object({
  status: Joi.string().valid(...COMPANY_STATUSES),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});
