import { Op } from 'sequelize';
import { AppError } from '../../lib/errors.js';
import { pushToUser } from '../../lib/realtime.js';
import { Notification } from '../../db/models/index.js';

const serialize = (n) => ({ id: n.id, type: n.type, payload: n.payload, readAt: n.readAt, createdAt: n.createdAt });

// Stores one notification per recipient and pushes each live as a `notification` event to the
// room user:<id> (US-07). A client that is offline sees it on its next GET /notifications.
export async function notify(userIds, type, payload) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const rows = await Notification.bulkCreate(unique.map((userId) => ({ userId, type, payload })));
  for (const row of rows) pushToUser(row.userId, 'notification', serialize(row));
  return rows;
}

export async function list(userId, { unread, page, limit }) {
  const where = { userId, ...(unread && { readAt: null }) };
  const [{ rows, count }, unreadCount] = await Promise.all([
    Notification.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit, offset: (page - 1) * limit }),
    Notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.map(serialize), page, limit, total: count, unreadCount };
}

// Idempotent: reading an already-read notification keeps its first read time.
export async function markRead(userId, id) {
  const notification = await Notification.findByPk(id);
  if (!notification || notification.userId !== userId) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  if (!notification.readAt) await notification.update({ readAt: new Date() });
  return serialize(notification);
}

export async function markAllRead(userId) {
  const [updated] = await Notification.update({ readAt: new Date() }, { where: { userId, readAt: { [Op.is]: null } } });
  return { updated };
}
