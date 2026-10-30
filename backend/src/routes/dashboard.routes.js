/**
 * Dashboard: statistik realtime, status service, quick stats,
 * activity log, dan riwayat bandwidth.
 */
import { prisma } from '../config/database.js';
import { writeAudit, recentLogs } from '../services/audit.service.js';
import {
  bandwidthHistory,
  controlService,
  getServices,
  getStats,
} from '../services/system.service.js';

async function quickStats() {
  const in30Days = new Date(Date.now() + 30 * 86_400_000);

  const [domains, databases, expiringSsl, users] = await Promise.all([
    prisma.domain.count({ where: { isSuspended: false } }),
    prisma.database.count(),
    prisma.ssl.findMany({
      where: { status: 'active', expiresAt: { lte: in30Days } },
      include: { domain: { select: { name: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 5,
    }),
    prisma.user.count({ where: { isActive: true } }),
  ]);

  return {
    domains,
    databases,
    expiringSsl: expiringSsl.map((s) => ({
      id: s.id,
      domain: s.domain?.name,
      expiresAt: s.expiresAt,
      daysLeft: s.expiresAt ? Math.ceil((s.expiresAt - Date.now()) / 86_400_000) : null,
    })),
    users,
  };
}

export default async function dashboardRoutes(app) {
  app.get('/summary', { preHandler: [app.authenticate] }, async (request) => {
    const [stats, services, activity, expiringSsl] = await Promise.all([
      getStats({ force: true }),
      getServices(),
      recentLogs(10),
      quickStats(),
    ]);
    return { stats, services, activity, ...expiringSsl };
  });

  app.get('/stats', { preHandler: [app.authenticate] }, async () => {
    return { stats: await getStats({ force: true }), services: await getServices() };
  });

  app.get('/bandwidth', { preHandler: [app.authenticate] }, async (request) => {
    const hours = Math.min(Math.max(Number(request.query.hours) || 6, 1), 24);
    const points = bandwidthHistory(hours);
    return { hours, points, note: 'Riwayat disimpan in-memory (24 jam). Untuk riwayat 7 hari, simpan sample ke database.' };
  });

  app.post(
    '/services/:key/:action',
    {
      preHandler: [app.authenticate, app.authorize('ADMIN')],
      schema: {
        params: {
          type: 'object',
          required: ['key', 'action'],
          properties: {
            key: { type: 'string', maxLength: 40 },
            action: { type: 'string', enum: ['start', 'stop', 'restart', 'reload'] },
          },
        },
      },
    },
    async (request) => {
      const { key, action } = request.params;
      try {
        const result = await controlService(key, action);
        await writeAudit(request, {
          action: `SERVICE_${action.toUpperCase()}`,
          resource: `service:${key}`,
          status: 'success',
          detail: { key, action },
        });
        return result;
      } catch (err) {
        await writeAudit(request, {
          action: `SERVICE_${action.toUpperCase()}`,
          resource: `service:${key}`,
          status: 'failed',
          detail: { key, action, error: err.message },
        });
        throw err;
      }
    },
  );
}
