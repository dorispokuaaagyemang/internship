import { apiError } from './api';

// Puts the API's per-field messages ({ error: { fields } }) onto a React Hook Form, and returns
// the overall message for an alert. Fields the form doesn't have are folded into that message.
export function applyServerErrors(err, setError, knownFields = []) {
  const { message, fields, code } = apiError(err);
  const unknown = [];
  for (const [name, text] of Object.entries(fields)) {
    if (knownFields.includes(name)) setError(name, { type: 'server', message: text });
    else unknown.push(text);
  }
  return { code, message: unknown.length ? `${message}: ${unknown.join(', ')}` : message };
}
