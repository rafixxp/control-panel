/**
 * Rute autentikasi: login, refresh, logout, profil.
 * Rate limit login: 5 percobaan / 15 menit per IP.
 */
import { prisma } from '../config/database.js';
import {
  AuthError,
  REFRESH_COOKIE,
  login,
  logout,
  me,
  refresh,
  refreshCookieOptions,
} from '../services/auth.service.js';

const loginSchema = {
  type: 'object',
  required: ['identifier', 'password'],
  additionalProperties: false,
  properties: {
    identifier: { type: 'string', minLength: 1, maxLength: 200 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
    rememberMe: { type: 'boolean', default: false },
  },
};

const LOGIN_RATE_LIMIT = {
  rateLimit: {
    max: 5,
    timeWindow: '15 minutes',
    keyGenerator: (request) => request.ip,
  },
};

export default async function authRoutes(app) {
  app.post('/login', { schema: { body: loginSchema }, config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
    const { identifier, password, rememberMe } = request.body;
    try {
      const result = await login({ identifier, password, rememberMe, request });
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(result.refreshMaxAge));
      return {
        accessToken: result.accessToken,
        user: result.user,
        expiresIn: 900,
      };
    } catch (err) {
      if (err instanceof AuthError) reply.code(err.status);
      throw err;
    }
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const result = await refresh({ token: request.cookies[REFRESH_COOKIE], request });
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(result.refreshMaxAge));
      return { accessToken: result.accessToken, user: result.user, expiresIn: 900 };
    } catch (err) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      if (err instanceof AuthError) reply.code(err.status);
      throw err;
    }
  });

  app.post('/logout', async (request, reply) => {
    await logout({ token: request.cookies[REFRESH_COOKIE], request });
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return { user: await me(request.user.id) };
  });

  app.get('/sessions', { preHandler: [app.authenticate] }, async (request) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
    });
    return { sessions };
  });
}
