/**
 * Nginx service — generate, pasang, edit, suspend dan hapus vHost.
 *
 * Semua tulisan file dibatasi chroot (PANEL_WEB_ROOT) dan nama domain
 * divalidasi regex whitelist [a-zA-Z0-9.-].
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { isValidDomain } from '../utils/pathGuard.js';
import { runWhitelisted } from '../utils/shell.js';

const TEMPLATE_PATH = new URL('../templates/nginx-vhost.conf', import.meta.url);

const PHP_VERSIONS = new Set(['7.4', '8.1', '8.2', '8.3']);

function assertDomain(domain) {
  if (!isValidDomain(domain)) {
    const err = new Error(`Nama domain tidak valid: ${domain}`);
    err.status = 400;
    throw err;
  }
  return domain.toLowerCase();
}

function assertPhpVersion(version) {
  if (!PHP_VERSIONS.has(String(version))) {
    const err = new Error(`Versi PHP tidak didukung: ${version}`);
    err.status = 400;
    throw err;
  }
  return String(version);
}

function resolveRoot(domain) {
  return path.join(env.webRoot, domain, 'public');
}

export async function renderVhost({
  domain,
  root,
  phpVersion,
  redirectHttps = true,
  gzip = true,
  customDirectives = '',
  ssl = false,
  index = 'index.php index.html index.htm',
}) {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');

  const redirectBlock = ssl && redirectHttps
    ? [
        '    # Redirect HTTP -> HTTPS',
        '    if ($scheme = http) {',
        '        return 301 https://$host$request_uri;',
        '    }',
      ].join('\n')
    : '';

  const gzipBlock = gzip
    ? [
        '    gzip on;',
        '    gzip_vary on;',
        '    gzip_min_length 1024;',
        '    gzip_types text/plain text/css application/json application/javascript text/xml image/svg+xml;',
      ].join('\n')
    : '';

  // Custom directive dimasukkan apa adanya — hanya Super Admin yang boleh
  // mengisi field ini, dan Nginx tetap diuji dengan `nginx -t` sebelum reload.
  const custom = customDirectives ? String(customDirectives).trim() : '';

  return template
    .replaceAll('{{DOMAIN}}', domain)
    .replaceAll('{{SERVER_NAME}}', domain)
    .replaceAll('{{ROOT}}', root)
    .replaceAll('{{PHP_VERSION}}', assertPhpVersion(phpVersion))
    .replaceAll('{{INDEX}}', index)
    .replaceAll('{{REDIRECT_BLOCK}}', redirectBlock)
    .replaceAll('{{GZIP_BLOCK}}', gzipBlock)
    .replaceAll('{{CUSTOM_DIRECTIVES}}', custom);
}

export function configPathFor(domain) {
  return path.join(env.nginxAvailableDir, `${domain}.conf`);
}

function enabledPathFor(domain) {
  return path.join(env.nginxEnabledDir, `${domain}.conf`);
}

async function testAndReload() {
  if (env.dryRun) return { tested: false, reloaded: false, detail: 'PANEL_DRY_RUN=1' };
  await runWhitelisted('nginx', ['-t']);
  await runWhitelisted('nginx', ['-s', 'reload']);
  return { tested: true, reloaded: true };
}

/**
 * Buat domain: direktori document root, vHost config, symlink, reload Nginx.
 */
export async function createDomain({ domain, phpVersion = '8.2', documentRoot, gzip = true, customDirectives = '' }) {
  const name = assertDomain(domain);
  const root = documentRoot ? path.resolve(documentRoot) : resolveRoot(name);
  if (!root.startsWith(env.webRoot + path.sep)) {
    const err = new Error(`Document root harus berada di dalam ${env.webRoot}`);
    err.status = 400;
    throw err;
  }

  const existing = await fs.stat(configPathFor(name)).catch(() => null);
  if (existing) {
    const err = new Error(`vHost ${name} sudah ada.`);
    err.status = 409;
    throw err;
  }

  await fs.mkdir(root, { recursive: true });
  await writeIndexPlaceholder(root);

  const config = await renderVhost({ domain: name, root, phpVersion, gzip, customDirectives, ssl: false });
  await fs.mkdir(env.nginxAvailableDir, { recursive: true });
  await fs.mkdir(env.nginxEnabledDir, { recursive: true });
  await fs.writeFile(configPathFor(name), config, { mode: 0o644 });

  const target = configPathFor(name);
  const link = enabledPathFor(name);
  await fs.rm(link, { force: true });
  await fs.symlink(target, link).catch(async (err) => {
    // Filesystem tanpa symlink (mis. bind mount) — salin file saja.
    if (err.code !== 'EPERM' && err.code !== 'EEXIST') throw err;
    await fs.copyFile(target, link);
  });

  const reload = await testAndReload();
  return { domain: name, documentRoot: root, configPath: target, ...reload };
}

async function writeIndexPlaceholder(root) {
  const index = path.join(root, 'index.html');
  try {
    await fs.access(index);
  } catch {
    await fs.writeFile(
      index,
      `<!doctype html><meta charset="utf-8"><title>NodePanel</title>
<h1>Site tersedia</h1><p>Document root dibuat oleh NodePanel. Ganti file ini.</p>\n`,
      { mode: 0o644 },
    );
  }
}

/** Update vHost (mis. ganti versi PHP) lalu reload. */
export async function updateVhost({ domain, phpVersion, gzip, customDirectives, redirectHttps = true, ssl = false }) {
  const name = assertDomain(domain);
  const cfgPath = configPathFor(name);
  const current = await fs.readFile(cfgPath, 'utf8').catch(() => null);
  if (!current) {
    const err = new Error(`vHost ${name} tidak ditemukan.`);
    err.status = 404;
    throw err;
  }

  const rootMatch = current.match(/^\s*root\s+(.+);$/m);
  const root = rootMatch ? rootMatch[1].trim() : resolveRoot(name);

  const config = await renderVhost({
    domain: name,
    root,
    phpVersion: phpVersion ?? (current.match(/php([\d.]+)-fpm/)?.[1] || '8.2'),
    gzip: gzip ?? !/\ngzip on;/.test(current),
    redirectHttps,
    ssl,
    customDirectives: customDirectives ?? '',
  });

  await fs.writeFile(cfgPath, config, { mode: 0o644 });
  const reload = await testAndReload();
  return { domain: name, configPath: cfgPath, ...reload };
}

/** Suspend = nonaktifkan config (rename ke .conf.disabled) + reload. */
export async function setSuspended(domain, suspended) {
  const name = assertDomain(domain);
  const enabled = enabledPathFor(name);
  const disabled = `${enabled}.disabled`;

  if (suspended) {
    await fs.rename(enabled, disabled).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  } else {
    await fs.rename(disabled, enabled).catch(async (err) => {
      if (err.code !== 'ENOENT') throw err;
      // Fallback: symlink ulang dari sites-available.
      await fs.rm(enabled, { force: true });
      await fs.symlink(configPathFor(name), enabled);
    });
  }
  const reload = await testAndReload();
  return { domain: name, suspended, ...reload };
}

/** Hapus vHost (config & symlink). Direktori document root hanya dihapus bila diminta. */
export async function deleteDomain(domain, { removeFiles = false } = {}) {
  const name = assertDomain(domain);
  await fs.rm(configPathFor(name), { force: true });
  await fs.rm(enabledPathFor(name), { force: true });
  await fs.rm(`${enabledPathFor(name)}.disabled`, { force: true });

  if (removeFiles) {
    const root = resolveRoot(name);
    if (root.startsWith(env.webRoot + path.sep)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  const reload = await testAndReload();
  return { domain: name, removedFiles: Boolean(removeFiles), ...reload };
}

export async function readVhost(domain) {
  const name = assertDomain(domain);
  const enabled = enabledPathFor(name);
  const disabled = `${enabled}.disabled`;
  const active = (await fs.readFile(enabled).catch(() => null)) ?? (await fs.readFile(disabled).catch(() => null));
  if (!active) return null;
  return {
    domain: name,
    suspended: !(await fs.stat(enabled).catch(() => null)),
    config: active.toString(),
    path: active ? (await fs.stat(enabled).catch(() => null) ? enabled : disabled) : disabled,
  };
}
