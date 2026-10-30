const RANK = { OPERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };

/**
 * Guard role. Dipakai sebagai preHandler:
 *   preHandler: [app.authenticate, app.authorize('ADMIN')]
 */
export function authorize(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return async (request, reply) => {
    const role = request.user?.role;
    if (!role) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Sesi tidak valid.' });
    }
    const minRank = Math.min(...[...allowed].map((r) => RANK[r] ?? 99));
    const roleRank = RANK[role] ?? 0;
    // SUPER_ADMIN selalu lolos; selain itu harus termasuk allowed atau di atasnya.
    if (!allowed.has(role) && roleRank < minRank) {
      return reply.code(403).send({
        error: 'forbidden',
        message: `Role ${role} tidak punya akses ke resource ini.`,
      });
    }
  };
}
