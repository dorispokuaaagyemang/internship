import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3 from '../lib/s3.js';

// Storage adapter (ARCHITECTURE.md §2.1): SeaweedFS in compose, Cloudflare R2 or any other
// S3-compatible service elsewhere. Buckets are private; encryption at rest is the store's
// (SeaweedFS -s3.encryptVolumeData, R2 always encrypts).
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export async function putObject({ bucket, key, body, contentType }) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject({ bucket, key }) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// A short-lived link to one private object. `downloadName` becomes the saved file's name.
export function presignDownload({ bucket, key, downloadName, contentType }) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}
