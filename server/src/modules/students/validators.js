import Joi from 'joi';

// US-02: name, university and department are mandatory. Each gets its own message so the
// form can highlight exactly the missing ones.
const required = (label, max) =>
  Joi.string()
    .trim()
    .max(max)
    .required()
    .messages({
      'any.required': `${label} is required`,
      'string.empty': `${label} is required`,
      'string.max': `${label} must be at most ${max} characters`,
    });

// PUT replaces the whole profile: an optional field left out is cleared.
export const profileSchema = Joi.object({
  fullName: required('Full name', 120),
  university: required('University', 150),
  department: required('Department', 150),
  gpa: Joi.number().min(0).max(5).precision(2).allow(null).default(null).messages({
    'number.base': 'GPA must be a number',
    'number.min': 'GPA must be between 0 and 5',
    'number.max': 'GPA must be between 0 and 5',
  }),
  bio: Joi.string().trim().max(2000).allow('', null).empty('').default(null),
  skills: Joi.array()
    .items(Joi.string().trim().replace(/\s+/g, ' ').min(1).max(50))
    .max(30)
    .default([])
    .messages({ 'array.max': 'List at most 30 skills' }),
});
