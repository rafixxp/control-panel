/**
 * System monitor — CPU, RAM, disk, network, load average, uptime,
 * serta status service (systemctl / pm2).
 *
 * Semua perintah sistem dijalankan lewat utils/shell (spawn + whitelist),
 * tidak pernah lewat exec() dengan string.
 */
import os from 'node:os';
import si from 'systeminformation';
import { env } from '../config/env.js';
import { runWhitelisted, serviceStatus } from '../utils/shell.js';

export const SERVICE_UNITS = [
  { key: 'nginx', label: 'Nginx', unit: 'nginx.service' },
  { key: 'mysql', label: 'MySQL', unit: 'mysql.service' },
  { key: 'redis', label: 'Redis', unit: 'redis-server.service' },
  { key: 'php7.4-fpm', label: 'PHP-FPM 7.4', unit: 'php7.4-fpm.service' },
  { key: 'php8.1-fpm', label: 'PHP-FPM 8.1', unit: 'php8.1-fpm.service' },
  { key: 'php8.2-fpm', label: 'PHP-FPM 8.2', unit: 'php8.2-fpm.service' },
  { key: 'php8.3-fpm', label: 'PHP-FPM 8.3', unit: 'php8.3-fpm.service' },
  { key: 'ssh', label: 'SSH', unit: 'ssh.service' },
];

const SERVICE_ACTIONS = new Set(['start', 'stop', 'restart', 'reload']);
const IGNORED_MOUNT_PREFIXES = ['/snap', '/boot', '/run', '/dev', '/efi', '/var/lib/docker'];

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

/* ------------------------------------------------------------------ */
/* Bandwidth sampler — ring buffer in-memory (5 detik / titik)         */
/* ------------------------------------------------------------------ */
const SAMPLE_MS = 5_000;
const MAX_SAMPLES = 24 * 60 * 12; // 24 jam
const samples = [];
let lastNet = null;
let sampler = null;

async function readNetTotals() {
  try {
    const stats = await si.networkStats();
    const rows = Array.isArray(stats) ? stats : [stats];
    let rx = 0;
    let tx = 0;
    for (const row of rows) {
      if (!row || row.iface === 'lo') continue;
      rx += Number(row.rx || 0);
      tx += Number(row.tx || 0);
    }
    return { rx, tx, at: Date.now() };
  } catch {
    return null;
  }
}

async function takeSample() {
  const current = await readNetTotals();
  if (current && lastNet) {
    const elapsed = Math.max((current.at - lastNet.at) / 1000, 0.001);
    samples.push({
      at: current.at,
      inKbps: Math.max(0, Math.round(((current.rx - lastNet.rx) * 8) / 1000 / elapsed)),
      outKbps: Math.max(0, Math.round(((current.tx - lastNet.tx) * 8) / 1000 / elapsed)),
    });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  }
  lastNet = current;
}

export function startBandwidthSampler() {
  if (sampler) return sampler;
  takeSample();
  sampler = setInterval(takeSample, SAMPLE_MS);
  sampler.unref?.();
  return sampler;
}

export function stopBandwidthSampler() {
  clearInterval(sampler);
  sampler = null;
}

export function bandwidthHistory(hours = 6) {
  const since = Date.now() - hours * 3600_000;
  return samples.filter((s) => s.at >= since);
}

/* ------------------------------------------------------------------ */
/* Statistik realtime                                                  */
/* ------------------------------------------------------------------ */
let lastStats = null;
let lastStatsAt = 0;

export async function getStats({ force = false } = {}) {
  if (!force && lastStats && Date.now() - lastStatsAt < 1000) return lastStats;

  const [currentLoad, mem, fsSizes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize().catch(() => []),
  ]);

  const disks = (fsSizes || [])
    .filter((fs) => fs.mount && fs.mount !== '/' ? !IGNORED_MOUNT_PREFIXES.some((p) => fs.mount.startsWith(p)) : true)
    .filter((fs) => Number(fs.size) > 0)
    .slice(0, 6)
    .map((fs) => ({
      mount: fs.mount,
      sizeGb: Number((fs.size / 1024 ** 3).toFixed(1)),
      usedGb: Number(((fs.size - fs.used) / 1024 ** 3).toFixed(1)),
      usePercent: Math.round(fs.use),
    }));

  const recent = samples.slice(-12);
  const net = recent.length
    ? {
        inKbps: Math.round(recent.reduce((a, s) => a + s.inKbps, 0) / recent.length),
        outKbps: Math.round(recent.reduce((a, s) => a + s.outKbps, 0) / recent.length),
      }
    : { inKbps: 0, outKbps: 0 };

  lastStats = {
    cpu: {
      percent: Math.round(currentLoad.currentLoad * 10) / 10,
      cores: currentLoad.cpus?.length ?? os.cpus().length,
      model: os.cpus()[0]?.model?.trim() || 'unknown',
    },
    ram: {
      totalGb: Number((mem.total / 1024 ** 3).toFixed(1)),
      usedGb: Number((mem.used / 1024 ** 3).toFixed(1)),
      percent: Math.round((mem.used / mem.total) * 1000) / 10,
    },
    disk: disks,
    network: net,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptime: formatUptime(os.uptime()),
    at: Date.now(),
  };
  lastStatsAt = Date.now();
  return lastStats;
}

/* ------------------------------------------------------------------ */
/* Service status & control                                            */
/* ------------------------------------------------------------------ */
export async function getServices() {
  const rows = await Promise.all(
    SERVICE_UNITS.map(async (svc) => ({
      key: svc.key,
      label: svc.label,
      unit: svc.unit,
      status: env.dryRun ? 'unknown' : await serviceStatus(svc.unit),
    })),
  );

  // PM2 dikelola PM2 sendiri, bukan systemd.
  let pm2Status = 'unknown';
  if (!env.dryRun) {
    try {
      const { stdout } = await runWhitelisted('pm2', ['jlist'], { timeoutMs: 5000 });
      const list = JSON.parse(stdout || '[]');
      const me = list.find((p) => p.name === 'nodepanel');
      pm2Status = me ? me.pm2_env?.status || 'unknown' : 'unknown';
    } catch {
      pm2Status = 'unknown';
    }
  }
  rows.push({ key: 'pm2', label: 'PM2', unit: 'pm2', status: pm2Status });
  return rows;
}

/**
 * Aksi cepat start/stop/restart/reload per service dari dashboard.
 * Hanya unit yang terdaftar di whitelist yang bisa disentuh.
 */
export async function controlService(key, action) {
  if (!SERVICE_ACTIONS.has(action)) {
    const err = new Error(`Aksi tidak dikenal: ${action}`);
    err.status = 400;
    throw err;
  }
  const svc = SERVICE_UNITS.find((s) => s.key === key);
  if (!svc) {
    const err = new Error(`Service tidak dikenal: ${key}`);
    err.status = 404;
    throw err;
  }
  if (env.dryRun) return { key, action, status: 'dry-run', detail: 'PANEL_DRY_RUN=1 — perintah tidak dijalankan.' };

  const { stdout } = await runWhitelisted('systemctl', [action, svc.unit], { timeoutMs: 30_000 });
  return { key, action, status: await serviceStatus(svc.unit), detail: stdout.trim() };
}
