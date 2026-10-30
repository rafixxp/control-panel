/**
 * NodePanel — entry point backend (Fastify).
 *
 * Port default 2087 (non-standar, sesuai panduan keamanan).
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { env } from './src/config/env.js';
import { closeDatabase } from './src/config/database.js';
import { authenticate } from './src/middleware/authenticate.js';
import { authorize } from './src/middleware/authorize.js';
import { auditLog } from './src/middleware/auditLog.js';
import { attachSocket } from './src/plugins/socket.js';
import { closeQueue } from './src/queues/ssl.queue.js';
import { stopBandwidthSampler } from './src/services/system.service.js';

import authRoutes from './src/routes/auth.routes.js';
import dashboardRoutes from './src/routes/dashboard.routes.js';
import domainRoutes from './src/routes/domain.routes.js';
import sslRoutes from './src/routes/ssl.routes.js';
import fileRoutes from './src/routes/files.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistRoot = path.resolve(__dirname, '../frontend/dist');

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: env.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'same-origin' },
    hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Tanpa origin (curl, server-to-server) tetap diizinkan; browser wajib cocok.
      if (!origin || origin === env.webOrigin || origin === env.panelUrl) return cb(null, true);
      const err = new Error('Origin tidak diizinkan (CORS).');
      err.statusCode = 403;
      err.code = 'cors_origin_denied';
      cb(err, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {});
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 10 },
  });

  await app.register(fastifyStatic, {
    root: frontendDistRoot,
    prefix: '/',
    index: 'index.html',
    wildcard: false,
    list: false,
    decorateReply: true,
  });

  // ---- Decorators dipakai semua route ----
  app.decorate('authenticate', authenticate);
  app.decorate('authorize', authorize);
  app.decorate('auditLog', auditLog);

  app.setErrorHandler((err, request, reply) => {
    const status = err.status || err.statusCode || 500;
    const isInternal = status >= 500;

    if (isInternal) request.log.error({ err }, 'request error');
    else request.log.debug({ err: err.message }, 'request rejected');

    reply.code(status).send({
      error: err.code || (isInternal ? 'internal_error' : 'error'),
      // Detail internal (query DB, stack) tidak pernah dikirim ke client.
      message: isInternal ? 'Terjadi kesalahan pada server. Coba lagi atau periksa log.' : err.message || 'Terjadi kesalahan.',
    });
  });

  // ---- Health check (untuk monitoring eksternal) ----
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'nodepanel',
    version: '0.1.0',
    uptime: Math.round(process.uptime()),
    dryRun: env.dryRun,
    at: new Date().toISOString(),
  }));

  // ---- Rute ----
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(domainRoutes, { prefix: '/api/domains' });
  await app.register(sslRoutes, { prefix: '/api/ssl' });
  await app.register(fileRoutes, { prefix: '/api/files' });

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url || '/';

    if (url.startsWith('/api/')) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Route ${request.method} ${request.url} tidak ditemukan.`,
      });
    }

    if (!url.startsWith('/api')) {
      return reply.sendFile('index.html', frontendDistRoot);
    }

    return reply.code(404).send({
      error: 'not_found',
      message: `Route ${request.method} ${request.url} tidak ditemukan.`,
    });
  });

  attachSocket(app);
  return app;
}

// Deteksi entry point harus tahan terhadap wrapper: PM2 menjalankan skrip
// lewat lib/ProcessContainerFork.js, sehingga process.argv[1] menunjuk ke
// wrapper PM2 dan bukan ke file ini. PM2 menyediakan jalur skrip asli lewat
// pm_exec_path, jadi periksa keduanya.
const entryPoints = [process.argv[1], process.env.pm_exec_path].filter(Boolean);
const isMain = entryPoints.some((entry) => import.meta.url === pathToFileURL(entry).href);

if (isMain) {
  const app = await buildApp();

  const shutdown = async (signal) => {
    app.log.info(`${signal} diterima — mematikan panel...`);
    await app.close();
    stopBandwidthSampler();
    await closeQueue();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`NodePanel berjalan di ${env.panelUrl} (port ${env.port})${env.dryRun ? ' [DRY RUN]' : ''}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
