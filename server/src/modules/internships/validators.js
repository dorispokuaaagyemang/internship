import Joi from 'joi';
import { ATTENDANCE, INTERNSHIP_STATUSES } from '../../db/models/internship.js';
import { isoDate } from '../applications/validators.js';

export const listQuery = Joi.object({
  status: Joi.string().valid(...INTERNSHIP_STATUSES),
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

export const datesSchema = Joi.object({
  startDate: isoDate.required().messages({ 'any.required': 'Start date is required' }),
  endDate: isoDate.required().messages({ 'any.required': 'End date is required' }),
});

// US-09
export const assignSchema = Joi.object({
  supervisorId: Joi.number().integer().positive().required().messages({ 'any.required': 'Choose a supervisor' }),
});

// US-10: rating 1-5, comments and attendance are mandatory.
export const evaluationSchema = Joi.object({
  period: Joi.string().trim().min(1).max(50).required().messages({
    'any.required': 'Period is required, e.g. "Week 4"',
    'string.empty': 'Period is required, e.g. "Week 4"',
  }),
  rating: Joi.number().integer().min(1).max(5).required().messages({
    'any.required': 'Rating is required',
    'number.base': 'Rating must be a whole number from 1 to 5',
    'number.min': 'Rating must be from 1 to 5',
    'number.max': 'Rating must be from 1 to 5',
  }),
  comments: Joi.string().trim().min(1).max(5000).required().messages({
    'any.required': 'Comments are required',
    'string.empty': 'Comments are required',
  }),
  attendance: Joi.string().valid(...ATTENDANCE).required().messages({
    'any.required': 'Attendance is required',
    'any.only': `Attendance must be one of: ${ATTENDANCE.join(', ')}`,
  }),
  isFinal: Joi.boolean().default(false),
});
