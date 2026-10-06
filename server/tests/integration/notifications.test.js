import http from 'node:http';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { closeRealtime, disconnectUser, initRealtime } from '../../src/lib/realtime.js';
import { notify } from '../../src/modules/notifications/service.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: {},
  User: { findByPk: vi.fn() },
  Notification: { bulkCreate: vi.fn(), findAndCountAll: vi.fn(), count: vi.fn(), findByPk: vi.fn(), update: vi.fn() },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));

const app = createApp();
const token = (id, role = 'student') => signAccessToken({ id, role });
const bearer = (id) => `Bearer ${token(id)}`;

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  Notification.bulkCreate.mockImplementation(async (rows) =>
    rows.map((r, i) => ({ id: 100 + i, readAt: null, createdAt: new Date('2026-10-06T10:00:00Z'), ...r })),
  );
});

describe('GET /api/v1/notifications (US-07)', () => {
  it("returns the user's notifications, newest first, with the unread count", async () => {
    Notification.findAndCountAll.mockResolvedValue({
      rows: [{ id: 1, type: 'application.status_changed', payload: { to: 'shortlisted' }, readAt: null, createdAt: new Date() }],
      count: 1,
    });
    Notification.count.mockResolvedValue(4);

    const res = await request(app).get('/api/v1/notifications?unread=true').set('Authorization', bearer(7));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, unreadCount: 4, items: [{ id: 1, type: 'application.status_changed', payload: { to: 'shortlisted' } }] });
    expect(Notification.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, readAt: null }, order: [['createdAt', 'DESC'], ['id', 'DESC']] }),
    );
  });

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});

describe('marking notifications read', () => {
  it('marks one read, once', async () => {
    const row = { id: 1, userId: 7, readAt: null, update: vi.fn(async function (v) { Object.assign(this, v); }) };
    Notification.findByPk.mockResolvedValue(row);

    const res = await request(app).patch('/api/v1/notifications/1/read').set('Authorization', bearer(7));

    expect(res.status).toBe(200);
    expect(res.body.notification.readAt).toEqual(expect.any(String));

    await request(app).patch('/api/v1/notifications/1/read').set('Authorization', bearer(7));
    expect(row.update).toHaveBeenCalledTimes(1);
  });

  it("cannot touch someone else's notification", async () => {
    Notification.findByPk.mockResolvedValue({ id: 1, userId: 8, readAt: null });

    expect((await request(app).patch('/api/v1/notifications/1/read').set('Authorization', bearer(7))).status).toBe(404);
  });

  it('marks everything read', async () => {
    Notification.update.mockResolvedValue([3]);

    const res = await request(app).post('/api/v1/notifications/read-all').set('Authorization', bearer(7));

    expect(res.body).toEqual({ updated: 3 });
    expect(Notification.update.mock.calls[0][1].where.userId).toBe(7);
  });
});

describe('live delivery over Socket.IO (US-07)', () => {
  let server;
  let url;
  const sockets = [];

  beforeAll(async () => {
    server = http.createServer(app);
    initRealtime(server, { adapter: false });
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await closeRealtime();
  });

  const open = (auth) =>
    new Promise((resolve, reject) => {
      const socket = connect(url, { path: '/socket.io', auth, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });

  it("pushes a new notification to that user's sockets only", async () => {
    const ada = await open({ token: token(7) });
    const ben = await open({ token: token(8) });
    const benGot = vi.fn();
    ben.on('notification', benGot);

    const received = new Promise((resolve) => ada.on('notification', resolve));
    await notify([7], 'application.status_changed', { applicationId: 30, to: 'shortlisted' });

    await expect(received).resolves.toMatchObject({ id: 100, type: 'application.status_changed', payload: { to: 'shortlisted' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(benGot).not.toHaveBeenCalled();
  });

  it('refuses a socket without a valid token', async () => {
    await expect(open({})).rejects.toThrow('UNAUTHENTICATED');
    await expect(open({ token: 'nope' })).rejects.toThrow('UNAUTHENTICATED');
  });

  it('US-12: refuses a suspended account, and can drop a user\'s open sockets', async () => {
    redis.get.mockResolvedValue('suspended');
    await expect(open({ token: token(9) })).rejects.toThrow('UNAUTHENTICATED');

    redis.get.mockResolvedValue('active');
    const socket = await open({ token: token(10) });
    const dropped = new Promise((resolve) => socket.on('disconnect', resolve));
    disconnectUser(10);
    await expect(dropped).resolves.toBe('io server disconnect');
  });
});
