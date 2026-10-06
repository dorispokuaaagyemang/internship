import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../../src/modules/auth/validators.js';

const valid = { email: 'Ada@Example.com', password: 'secret#123', phone: '+254 712 345678', role: 'student' };

function errors(body) {
  const { error } = registerSchema.validate(body, { abortEarly: false });
  return error ? error.details.map((d) => d.message) : [];
}

describe('register validation', () => {
  it('normalises email and phone (stored as E.164)', () => {
    const { value, error } = registerSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.email).toBe('ada@example.com');
    expect(value.phone).toBe('+254712345678');
  });

  it('US-01: password needs at least 8 characters', () => {
    expect(errors({ ...valid, password: 'a#1' })).toContain('Password must be at least 8 characters');
  });

  it('US-01: password needs a number', () => {
    expect(errors({ ...valid, password: 'secret#abc' })).toContain('Password must contain at least one number');
  });

  it('US-01: password needs a special character', () => {
    expect(errors({ ...valid, password: 'secret1234' })).toContain(
      'Password must contain at least one special character',
    );
  });

  it('rejects a phone without a country code or with a bad format', () => {
    expect(errors({ ...valid, phone: '0712345678' })[0]).toMatch(/country code/);
    expect(errors({ ...valid, phone: '+2541' })[0]).toMatch(/country code/);
  });

  it('only students and company reps can self-register', () => {
    expect(errors({ ...valid, role: 'company_rep' })).toEqual([]);
    expect(errors({ ...valid, role: 'admin' })).toHaveLength(1);
    expect(errors({ ...valid, role: 'supervisor' })).toHaveLength(1);
  });
});

describe('login validation', () => {
  it('requires email and password', () => {
    const { error } = loginSchema.validate({}, { abortEarly: false });
    expect(error.details.map((d) => d.path[0])).toEqual(['email', 'password']);
  });
});
