/**
 * Socket.io — monitor realtime dashboard.
 *
 * Handshake wajib menyertakan access token (auth: { token }). Hanya user
 * terautentikasi yang menerima broadcast statistik.
 */
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getServices, getStats, startBandwidthSampler } from '../services/system.service.js';

const STATS_INTERVAL_MS = 2000;

let lastStats = null;
let lastServices = null;

export function attachSocket(fastify) {
  const io = new Server(fastify.server, {
    path: '/socket.io',
    cors: { origin: env.webOrigin, credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] });
      socket.user = { id: payload.sub, name: payload.name, role: payload.role };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    if (lastStats) {
      socket.emit('system:stats', { ...lastStats, services: lastServices });
    } else {
      // Belum ada sampling — kirim satu kali snapshot lalu biarkan interval
      // yang mengirim update berikutnya.
      getStats({ force: true })
        .then((stats) => socket.emit('system:stats', { ...stats, services: lastServices }))
        .catch(() => {});
    }
  });

  const timer = setInterval(async () => {
    if (io.engine.clientsCount === 0) return;
    try {
      const [stats, services] = await Promise.all([getStats(), getServices()]);
      lastStats = stats;
      lastServices = services;
      io.emit('system:stats', { ...stats, services });
    } catch (err) {
      fastify.log.warn({ err: err.message }, 'gagal mengambil statistik sistem');
    }
  }, STATS_INTERVAL_MS);

  timer.unref?.();
  startBandwidthSampler();

  fastify.io = io;
  fastify.addHook('onClose', async () => {
    clearInterval(timer);
    await io.close();
  });

  return io;
}
