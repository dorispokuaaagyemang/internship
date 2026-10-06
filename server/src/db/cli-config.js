// Consumed by sequelize-cli (see .sequelizerc); reuses the validated app config.
import { config } from '../config/index.js';

const connection = {
  username: config.db.user,
  password: config.db.password,
  database: config.db.name,
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  timezone: '+00:00',
  dialectOptions: { connectTimeout: 30_000, ...(config.db.ssl && { ssl: config.db.ssl }) },
};

export default { development: connection, test: connection, production: connection };
