import { AppError } from '../lib/errors.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  } else if (err.type === 'entity.too.large') {
    err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.fields) error.fields = err.fields;
    return res.status(err.status).json({ error });
  }

  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
