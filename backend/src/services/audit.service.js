import { prisma } from '../config/database.js';

/**
 * Tulis satu baris AuditLog. Tidak pernah melempar error ke jalur request.
 */
export async function writeAudit(request, { action, resource, status = 'success', detail = null, userId = null }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? request?.user?.id ?? null,
        action,
        resource: resource || '-',
        ipAddress: typeof request?.ip === 'string' ? request.ip : 'unknown',
        userAgent: request?.headers?.['user-agent']?.slice(0, 255) || null,
        status,
        detail: detail ?? undefined,
      },
    });
  } catch (err) {
    console.error('[audit] gagal menulis log:', err.message);
  }
}

/** 10 log aktivitas terbaru untuk dashboard. */
export async function recentLogs(limit = 10) {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    resource: row.resource,
    status: row.status,
    ip: row.ipAddress,
    at: row.createdAt,
    user: row.user ? row.user.name : 'Sistem',
  }));
}

/**
 * Hitung jumlah login gagal untuk identifier dalam jendela menit tertentu.
 * Dipakai untuk account lockout (10 gagal berturut-turut).
 */
export async function countFailedLogins(identifier, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60_000);
  return prisma.auditLog.count({
    where: {
      action: 'LOGIN',
      status: 'failed',
      resource: `user:${identifier.toLowerCase()}`,
      createdAt: { gte: since },
    },
  });
}

/** Ringkasan log untuk halaman audit (phase 2) — dipakai dashboard. */
export async function listLogs({ userId = null, from = null, to = null, limit = 50 } = {}) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { user: { select: { name: true, email: true } } },
  });
}
