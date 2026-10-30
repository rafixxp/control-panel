import crypto from 'node:crypto';
import path from 'node:path';

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value) return value;
  if (isProd) throw new Error(`[env] ${name} wajib di-set di production.`);
  return '';
}

function secret(name) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`[env] ${name} wajib di-set di production.`);
  const fallback = crypto.createHash('sha256').update(`nodepanel-dev:${name}`).digest('hex');
  console.warn(`[env] ${name} belum di-set — memakai secret sementara untuk development.`);
  return fallback;
}

function list(name, fallback) {
  const raw = process.env[name] ?? fallback;
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

export const env = {
  nodeEnv: NODE_ENV,
  isProd,
  port: Number(process.env.PORT || 2087),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',

  jwtAccessSecret: secret('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET'),
  cryptoKey: secret('PANEL_CRYPTO_KEY'),
  accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),

  webOrigin: required('WEB_ORIGIN', 'http://localhost:5173'),
  panelUrl: required('PANEL_URL', 'http://localhost:2087'),

  webRoot: path.resolve(process.env.PANEL_WEB_ROOT || '/var/www'),
  homeRoot: path.resolve(process.env.PANEL_HOME_ROOT || '/home'),
  fileRoots: list('PANEL_FILE_ROOTS', '/var/www,/home'),

  nginxAvailableDir: path.resolve(process.env.NGINX_AVAILABLE_DIR || '/etc/nginx/sites-available'),
  nginxEnabledDir: path.resolve(process.env.NGINX_ENABLED_DIR || '/etc/nginx/sites-enabled'),
  nginxConf: path.resolve(process.env.NGINX_CONF || '/etc/nginx/nginx.conf'),

  certbotEmail: process.env.CERTBOT_EMAIL || '',
  sslDir: path.resolve(process.env.SSL_DIR || '/etc/letsencrypt'),

  // Development: tidak menjalankan perintah sistem (nginx/certbot/systemctl).
  dryRun: process.env.PANEL_DRY_RUN === '1',

  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 100),

  // Aktifkan hanya bila panel berada di belakang reverse proxy (nginx).
  trustProxy: process.env.TRUST_PROXY === '1',
};

if (!env.databaseUrl && env.isProd) {
  throw new Error('[env] DATABASE_URL wajib di-set di production.');
}
