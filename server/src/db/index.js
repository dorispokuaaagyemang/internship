import { Sequelize } from 'sequelize';
import { config } from '../config/index.js';
import logger from '../lib/logger.js';

export const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  timezone: '+00:00',
  // A hosted database over TLS can take ~10 s to accept a new connection (mysql2's default limit).
  dialectOptions: { connectTimeout: 30_000, ...(config.db.ssl && { ssl: config.db.ssl }) },
  logging: config.env === 'development' ? (sql) => logger.debug(sql) : false,
  define: { underscored: true, timestamps: true },
  pool: { max: 10, min: 0, idle: 10000 },
});
