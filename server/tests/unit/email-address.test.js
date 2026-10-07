import { describe, expect, it } from 'vitest';
import { isReservedAddress } from '../../src/integrations/email.js';

describe('isReservedAddress', () => {
  it('skips the demo seed and erased accounts (no mailbox exists there)', () => {
    expect(isReservedAddress('ama.mensah@demo.example.com')).toBe(true);
    expect(isReservedAddress('deleted-12@deleted.invalid')).toBe(true);
    expect(isReservedAddress('someone@example.org')).toBe(true);
    expect(isReservedAddress('x@school.test')).toBe(true);
  });

  it('sends to real domains', () => {
    expect(isReservedAddress('student@gmail.com')).toBe(false);
    expect(isReservedAddress('hr@company.com.gh')).toBe(false);
    expect(isReservedAddress('me@myexample.com')).toBe(false);
  });
});
