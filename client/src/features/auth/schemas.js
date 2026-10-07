import { z } from 'zod';

// Mirrors the server's Joi rules (server/src/modules/auth/validators.js), so most mistakes are
// caught before a round trip. The server still decides; its messages are shown too.

export const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email address');

// US-01: at least 8 characters, one number, one special character.
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/\d/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// The country code is required; the server does the full check (libphonenumber). Not verified.
export const phone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .regex(/^\+[\d\s-]{8,20}$/, 'Include the country code, e.g. +233241234567');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  // US-01
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  role: z.enum(['student', 'company_rep'], { message: 'Choose an account type' }),
  email,
  password,
  phone,
});

