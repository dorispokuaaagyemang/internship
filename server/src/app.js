import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config } from './config/index.js';
import logger from './lib/logger.js';
import routes from './routes.js';
import './modules/notifications/listeners.js';
import { notFound, errorHandler } from './middleware/error.js';
import { requireOrigin } from './middleware/origin.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy); // nginx, or Render's load balancer
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  // After pino-http, so a refused request is logged and carries its x-request-id.
  if (config.originSecret) app.use(requireOrigin(config.originSecret));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
