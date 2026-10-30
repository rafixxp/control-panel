/**
 * Auth service — login, refresh token (rotasi), logout.
 *
 * - Access token: JWT HS256, 15 menit.
 * - Refresh token: 30 hari, disimpan sebagai SHA-256 di tabel Session,
 *   dikirim sebagai cookie httpOnly + SameSite=Strict.
 * - Password: bcrypt cost 12.
 * - Lockout: 10 login gagal dalam 15 menit → ditolak sampai jendela lewat.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { countFailedLogins, writeAudit } from './audit.service.js';

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_WINDOW_MINUTES = 15;
const REFRESH_COOKIE = 'np_rt';

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
    this.code = 'auth_error';
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role },
    env.jwtAccessSecret,
    { expiresIn: env.accessTtl, algorithm: 'HS256' },
  );
}

async function createSession(user, { ip, userAgent }) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 86_400_000);
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: sha256(token),
      ipAddress: ip || 'unknown',
      userAgent: (userAgent || '').slice(0, 255),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export function refreshCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: maxAgeMs,
  };
}

export async function login({ identifier, password, rememberMe = false, request }) {
  const id = String(identifier || '').trim();
  const ip = request?.ip || 'unknown';

  if (!id || !password) throw new AuthError('Email dan password wajib diisi.', 400);

  const failed = await countFailedLogins(id, LOCK_WINDOW_MINUTES);
  if (failed >= MAX_FAILED_ATTEMPTS) {
    await writeAudit(request, {
      action: 'LOGIN',
      resource: `user:${id.toLowerCase()}`,
      status: 'failed',
      detail: { reason: 'locked_out' },
      userId: null,
    });
    throw new AuthError(`Terlalu banyak percobaan gagal. Coba lagi dalam ${LOCK_WINDOW_MINUTES} menit.`, 429);
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id.toLowerCase() }, { name: id }] },
  });

  const ok = user ? await bcrypt.compare(password, user.password) : false;
  if (!user || !ok || !user.isActive) {
    await writeAudit(request, {
      action: 'LOGIN',
      resource: `user:${id.toLowerCase()}`,
      status: 'failed',
      detail: { reason: !user ? 'unknown_user' : !ok ? 'bad_password' : 'inactive' },
      userId: user?.id ?? null,
    });
    throw new AuthError('Email/password salah atau akun dinonaktifkan.', 401);
  }

  const ttlDays = rememberMe ? env.refreshTtlDays : 1;
  const sessionToken = randomToken(48);
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: sha256(sessionToken),
      ipAddress: ip,
      userAgent: (request?.headers?.['user-agent'] || '').slice(0, 255),
      expiresAt,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), lastLoginIp: ip },
  });

  await writeAudit(request, {
    action: 'LOGIN',
    resource: `user:${id.toLowerCase()}`,
    status: 'success',
    userId: user.id,
    detail: { rememberMe },
  });

  return {
    accessToken: signAccessToken(user),
    refreshToken: sessionToken,
    refreshMaxAge: ttlDays * 86_400_000,
    user: publicUser(user),
  };
}

export async function refresh({ token, request }) {
  if (!token) throw new AuthError('Refresh token tidak ditemukan.', 401);

  const session = await prisma.session.findUnique({
    where: { refreshToken: sha256(token) },
    include: { user: true },
  });

  if (!session) throw new AuthError('Refresh token tidak valid.', 401);
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthError('Refresh token kedaluwarsa.', 401);
  }
  if (!session.user.isActive) throw new AuthError('Akun dinonaktifkan.', 401);

  // Rotasi: token lama dicabut, token baru diterbitkan (deteksi reuse).
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  const rotated = await createSession(session.user, {
    ip: request?.ip,
    userAgent: request?.headers?.['user-agent'],
  });

  return {
    accessToken: signAccessToken(session.user),
    refreshToken: rotated.token,
    refreshMaxAge: Math.max(rotated.expiresAt - Date.now(), 0),
    user: publicUser(session.user),
  };
}

export async function logout({ token, request }) {
  if (!token) return { revoked: false };
  const session = await prisma.session.findUnique({ where: { refreshToken: sha256(token) } });
  if (!session) return { revoked: false };
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  await writeAudit(request, {
    action: 'LOGOUT',
    resource: `user:${session.userId}`,
    status: 'success',
    userId: session.userId,
  });
  return { revoked: true };
}

/** Cabut semua sesi user (dipakai saat password diganti). */
export async function revokeAllSessions(userId) {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}

export async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError('User tidak ditemukan.', 404);
  return publicUser(user);
}

export { REFRESH_COOKIE, AuthError };
