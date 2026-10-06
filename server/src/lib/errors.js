// Thrown by services; rendered by middleware/error.js as { error: { code, message, fields? } }.
export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
