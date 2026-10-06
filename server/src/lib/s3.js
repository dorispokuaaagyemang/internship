import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

// Provider-agnostic: SeaweedFS locally and on the VPS, any S3-compatible service later.
export default new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});
