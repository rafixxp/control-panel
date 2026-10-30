import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Verifikasi Bearer access token (15 menit) dan menempelkan payload ke request.user.
 */
export async function authenticate(request, reply) {
  const header = request.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Access token tidak ditemukan.' });
  }

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] });
    request.user = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
    };
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return reply.code(401).send({
      error: expired ? 'token_expired' : 'unauthorized',
      message: expired ? 'Access token kedaluwarsa.' : 'Access token tidak valid.',
    });
  }
}
