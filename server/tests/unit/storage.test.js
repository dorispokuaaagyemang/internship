import { describe, expect, it } from 'vitest';
import { presignDownload } from '../../src/integrations/storage.js';

// Signing happens locally, so this exercises the real S3 client without a network call.
describe('storage adapter', () => {
  it('signs a private download link that expires after 5 minutes (US-02)', async () => {
    const url = new URL(
      await presignDownload({ bucket: 'resumes', key: 'students/7/a.pdf', downloadName: 'Müller CV.pdf', contentType: 'application/pdf' }),
    );

    expect(url.origin).toBe('http://localhost:8333');
    expect(url.pathname).toBe('/resumes/students/7/a.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toBe("attachment; filename*=UTF-8''M%C3%BCller%20CV.pdf");
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
  });
});
