import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashToken, signAccessToken, verifyAccessToken } from '../../src/lib/tokens.js';

describe('access tokens (ARCHITECTURE.md §4.1)', () => {
  it('round-trips the user id and role', () => {
    const token = signAccessToken({ id: 42, role: 'student' });
    expect(verifyAccessToken(token)).toEqual({ id: 42, role: 'student' });
  });

  it('expires after the configured lifetime', () => {
    const token = signAccessToken({ id: 1, role: 'student' });
    const { iat, exp } = jwt.decode(token);
    expect(exp - iat).toBe(15 * 60);
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret-some-other-secret', { subject: '1' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ role: 'student' }, process.env.JWT_ACCESS_SECRET, { subject: '1', expiresIn: -10 });
    expect(() => verifyAccessToken(expired)).toThrow(/expired/);
  });

  it('rejects an unsigned token', () => {
    const none = jwt.sign({ role: 'admin' }, null, { algorithm: 'none', subject: '1' });
    expect(() => verifyAccessToken(none)).toThrow();
  });
});

describe('opaque tokens', () => {
  it('are random and hash to 64 hex characters', () => {
    const a = generateOpaqueToken();
    expect(a).not.toBe(generateOpaqueToken());
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
