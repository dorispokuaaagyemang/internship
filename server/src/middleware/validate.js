import { AppError } from '../lib/errors.js';

// Validates req.body (or req.query) against a Joi schema and replaces it with the cleaned value.
// Every failing field is reported at once: { fields: { email: '...', password: '...' } }.
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[source] ?? {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const fields = {};
      for (const detail of error.details) {
        const key = detail.path.join('.');
        fields[key] ??= detail.message;
      }
      return next(new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid', fields));
    }
    // Express 5 makes req.query a read-only getter, so it is redefined rather than assigned.
    Object.defineProperty(req, source, { value, writable: true, configurable: true, enumerable: true });
    next();
  };
}
