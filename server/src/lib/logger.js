import pino from 'pino';
import { config } from '../config/index.js';

export default pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
