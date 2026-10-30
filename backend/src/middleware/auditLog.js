import { writeAudit } from '../services/audit.service.js';

/**
 * preHandler Fastify untuk mencatat sebuah aksi ke AuditLog.
 *   preHandler: [app.authenticate, app.auditLog({ action: 'DELETE_DOMAIN' })]
 *
 * Untuk aksi dengan resource dinamis (nama domain dsb.), panggil writeAudit()
 * langsung dari handler setelah resource diketahui.
 */
export function auditLog({ action, resource = '-' }) {
  return async (request) => {
    await writeAudit(request, { action, resource });
  };
}

export { writeAudit };
