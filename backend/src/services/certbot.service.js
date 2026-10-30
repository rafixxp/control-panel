/**
 * Certbot service — issue, renew, revoke, dan upload sertifikat manual.
 *
 * Perintah dijalankan via utils/shell (spawn + whitelist). PANEL_DRY_RUN=1
 * mensimulasikan hasilnya agar bisa dikembangkan tanpa akses root.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { isValidDomain } from '../utils/pathGuard.js';
import { runWhitelisted } from '../utils/shell.js';

function assertDomain(domain) {
  if (!isValidDomain(domain)) {
    const err = new Error(`Nama domain tidak valid: ${domain}`);
    err.status = 400;
    throw err;
  }
  return domain.toLowerCase();
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function sslSummary(cert) {
  const left = daysUntil(cert.expiresAt);
  return {
    id: cert.id,
    domainId: cert.domainId,
    domain: cert.domain?.name ?? null,
    issuer: cert.issuer,
    status: cert.status,
    expiresAt: cert.expiresAt,
    daysLeft: left,
    autoRenew: cert.autoRenew,
    warning: left !== null && left <= 30,
    critical: left !== null && left <= 14,
  };
}

/**
 * Terbitkan sertifikat Let's Encrypt untuk sebuah domain.
 * @returns {Promise<{issuer:string,status:string,expiresAt:Date|null,mode:string}>}
 */
export async function issue({ domain, email = env.certbotEmail, dryRun = false }) {
  const name = assertDomain(domain);
  if (!email) {
    const err = new Error('CERTBOT_EMAIL belum dikonfigurasi.');
    err.status = 400;
    throw err;
  }

  if (env.dryRun || dryRun) {
    return {
      issuer: 'letsencrypt',
      status: 'active',
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
      mode: env.dryRun ? 'dry-run' : 'certbot --dry-run',
    };
  }

  const args = [
    'certonly',
    '--nginx',
    '-d', name,
    '--non-interactive',
    '--agree-tos',
    '--keep-until-expiring',
    '-m', email,
  ];
  await runWhitelisted('certbot', args, { timeoutMs: 120_000 });
  const expiresAt = await expiryFromDisk(name);
  return { issuer: 'letsencrypt', status: 'active', expiresAt, mode: 'certbot' };
}

export async function renew({ domain }) {
  const name = assertDomain(domain);
  if (env.dryRun) {
    return { status: 'active', expiresAt: new Date(Date.now() + 90 * 86_400_000), mode: 'dry-run' };
  }
  await runWhitelisted('certbot', ['renew', '--cert-name', name, '--non-interactive'], { timeoutMs: 120_000 });
  return { status: 'active', expiresAt: await expiryFromDisk(name), mode: 'certbot' };
}

export async function revoke({ domain, deleteIt = false }) {
  const name = assertDomain(domain);
  if (env.dryRun) return { status: 'revoked', mode: 'dry-run' };
  const args = ['revoke', '--cert-path', path.join(env.sslDir, 'live', name, 'fullchain.pem'), '--non-interactive'];
  if (deleteIt) args.push('--delete');
  await runWhitelisted('certbot', args, { timeoutMs: 60_000 });
  return { status: 'revoked', mode: 'certbot' };
}

/**
 * Upload sertifikat manual (paste certificate + private key).
 * File disimpan di SSL_DIR/manual/<domain>/ dengan permission 600.
 */
export async function uploadManual({ domain, certificate, privateKey }) {
  const name = assertDomain(domain);
  const cert = String(certificate || '').trim();
  const key = String(privateKey || '').trim();

  if (!cert.includes('BEGIN CERTIFICATE')) {
    const err = new Error('Certificate tidak valid (tidak mengandung BEGIN CERTIFICATE).');
    err.status = 400;
    throw err;
  }
  if (!key.includes('BEGIN')) {
    const err = new Error('Private key tidak valid.');
    err.status = 400;
    throw err;
  }

  const dir = path.join(env.sslDir, 'manual', name);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, 'fullchain.pem'), `${cert}\n`, { mode: 0o644 });
  await fs.writeFile(path.join(dir, 'privkey.pem'), `${key}\n`, { mode: 0o600 });

  return {
    issuer: 'custom',
    status: 'active',
    expiresAt: parseCertExpiry(cert),
    path: dir,
  };
}

/** Estimasi expiry dari field Not After pada sertifikat (format ASN.1). */
export function parseCertExpiry(pem) {
  const notAfter = pem.match(/Not After\s*:\s*(.+)/);
  if (!notAfter) return null;
  const parsed = new Date(notAfter[1].trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function expiryFromDisk(domain) {
  if (env.dryRun) return new Date(Date.now() + 90 * 86_400_000);
  try {
    const pem = await fs.readFile(path.join(env.sslDir, 'live', domain, 'fullchain.pem'), 'utf8');
    return parseCertExpiry(pem);
  } catch {
    return null;
  }
}

/** Baca expiry dari disk untuk semua domain (dipakai scheduler auto-renew). */
export async function inspectLive() {
  try {
    const entries = await fs.readdir(path.join(env.sslDir, 'live'), { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const expiresAt = await expiryFromDisk(entry.name);
      result.push({ domain: entry.name, expiresAt, daysLeft: daysUntil(expiresAt) });
    }
    return result;
  } catch {
    return [];
  }
}
