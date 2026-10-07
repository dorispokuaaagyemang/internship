import Joi from 'joi';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// US-01: at least 8 characters, one number, one special character.
const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/\d/, 'number')
  .pattern(/[^A-Za-z0-9]/, 'special character')
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.name': 'Password must contain at least one {#name}',
  });

// The country code and format are checked; stored as E.164. Not verified (no SMS, US-00B dropped).
export const phone = Joi.string()
  .trim()
  .custom((value, helpers) => {
    const parsed = parsePhoneNumberFromString(value);
    if (!parsed || !parsed.isValid()) return helpers.error('phone.invalid');
    return parsed.number;
  })
  .messages({ 'phone.invalid': 'Enter a valid phone number with its country code, e.g. +254712345678' });

const email = Joi.string().trim().lowercase().email().max(255).required();

export const registerSchema = Joi.object({
  // US-01: the student's (or representative's) name.
  fullName: Joi.string().trim().min(2).max(120).required().messages({
    'any.required': 'Full name is required',
    'string.empty': 'Full name is required',
    'string.min': 'Full name is required',
  }),
  email,
  password,
  phone: phone.required(),
  // Supervisors are added by their company and admins are seeded; neither self-registers.
  role: Joi.string().valid('student', 'company_rep').required(),
});

export const resendVerificationSchema = Joi.object({ email });

// US-09: an invited supervisor sets their password; the same rules as registration (US-01).
export const acceptInviteSchema = Joi.object({ token: Joi.string().max(200).required(), password });

export const loginSchema = Joi.object({
  email,
  password: Joi.string().max(128).required(),
});

