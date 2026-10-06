// Creates an admin account (admins never self-register). Prints a generated password once.
//   npm run admin:create -w server -- admin@example.com
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { config } from '../src/config/index.js';
import { sequelize, User } from '../src/db/models/index.js';
import { record } from '../src/modules/audit/service.js';

const { value: email, error } = Joi.string().trim().lowercase().email().required().validate(process.argv[2]);
if (error) {
  console.error('Usage: npm run admin:create -w server -- <email>');
  process.exit(1);
}

try {
  if (await User.findOne({ where: { email }, paranoid: false })) {
    console.error(`An account with ${email} already exists. Choose another email.`);
    process.exitCode = 1;
  } else {
    // Ends with a digit and a symbol so it also meets the US-01 password rules.
    const password = `${randomBytes(18).toString('base64url')}7#`;
    const now = new Date();
    const admin = await User.create({
      email,
      passwordHash: await bcrypt.hash(password, config.auth.bcryptCost),
      role: 'admin',
      status: 'active',
      emailVerifiedAt: now,
    });
    await record({ actor: null, action: 'admin.created', entity: { type: 'user', id: admin.id }, metadata: { via: 'cli' } });

    console.log(`Admin ${email} created (id ${admin.id}).`);
    console.log(`Password: ${password}`);
    console.log('It is shown only this once. Store it in a password manager.');
  }
} finally {
  await sequelize.close();
}
