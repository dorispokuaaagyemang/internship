import multer from 'multer';
import { AppError } from '../lib/errors.js';

// Accepts one file in multipart field `field`, held in memory (req.file.buffer). The size
// limit is enforced while the upload streams in, so an oversized file is never fully read.
export function singleFile(field, { maxBytes, label }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    // Browsers send file names as UTF-8; multer would otherwise read them as latin1.
    defParamCharset: 'utf8',
    limits: { fileSize: maxBytes, files: 1, fields: 0 },
  }).single(field);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) {
        if (!req.file) return next(new AppError(422, 'VALIDATION_ERROR', `Choose a ${label} to upload`, { [field]: 'File is required' }));
        return next();
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(maxBytes / (1024 * 1024));
        return next(new AppError(413, 'FILE_TOO_LARGE', `The ${label} must be under ${mb} MB`, { [field]: `Must be under ${mb} MB` }));
      }
      if (err instanceof multer.MulterError) {
        return next(new AppError(422, 'VALIDATION_ERROR', `Send one file in the "${field}" field`, { [field]: 'Unexpected upload' }));
      }
      next(err);
    });
  };
}
