/**
 * Wrapper spawn() yang aman.
 *
 * Aturan emas: JANGAN pernah menjalankan perintah lewat exec()/execSync dengan
 * string yang mengandung input user. Semua perintah dijalankan dengan
 * child_process.spawn() + array argumen (tanpa shell), dan nama perintah
 * harus terdaftar di whitelist.
 */
import { spawn } from 'node:child_process';

export class CommandError extends Error {
  constructor(message, { code = 1, stdout = '', stderr = '' } = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/** Perintah yang boleh dijalankan panel, beserta bentuk argumen yang diizinkan. */
export const COMMAND_WHITELIST = Object.freeze({
  nginx: { bin: 'nginx', allowedArgs: ['-t', '-s', 'reload', '-s', 'stop'] },
  systemctl: {
    bin: 'systemctl',
    allowedActions: ['is-active', 'is-enabled', 'start', 'stop', 'restart', 'reload', 'status'],
    allowedUnits: [
      'nginx.service',
      'mysql.service',
      'mariadb.service',
      'redis-server.service',
      'ssh.service',
      'php7.4-fpm.service',
      'php8.1-fpm.service',
      'php8.2-fpm.service',
      'php8.3-fpm.service',
    ],
  },
  certbot: { bin: 'certbot', allowedSubcommands: ['certonly', 'renew', 'revoke', 'certificates', 'delete'] },
  ufw: { bin: 'ufw', allowedArgs: ['status', 'status numbered'] },
  pm2: { bin: 'pm2', allowedArgs: ['jlist', 'list', 'restart nodepanel', 'reload nodepanel'] },
});

const UNSAFE_CHARS = /[\n\r;&|`$><\\"']/;

function assertSafeArgs(args) {
  for (const arg of args) {
    if (typeof arg !== 'string') throw new CommandError('Argumen perintah harus string.');
    if (UNSAFE_CHARS.test(arg)) {
      throw new CommandError(`Argumen mengandung karakter berbahaya: ${JSON.stringify(arg)}`);
    }
  }
}

/**
 * Jalankan perintah whitelist dengan array argumen.
 * @param {string} key   kunci whitelist (nginx|systemctl|certbot|ufw)
 * @param {string[]} args argumen perintah (tanpa nama binari)
 * @param {{cwd?: string, timeoutMs?: number, env?: object}} opts
 */
export function runWhitelisted(key, args = [], opts = {}) {
  const entry = COMMAND_WHITELIST[key];
  if (!entry) return Promise.reject(new CommandError(`Perintah tidak di-whitelist: ${key}`));

  assertSafeArgs(args);

  const { timeoutMs = 30_000, cwd, env: extraEnv } = opts;

  return new Promise((resolve, reject) => {
    const child = spawn(entry.bin, args, {
      cwd,
      shell: false,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const cap = 512 * 1024;

    child.stdout.on('data', (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CommandError(`Timeout ${timeoutMs}ms: ${entry.bin} ${args.join(' ')}`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CommandError(`Gagal menjalankan ${entry.bin}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, stdout, stderr });
      else reject(new CommandError(`${entry.bin} ${args.join(' ')} keluar dengan kode ${code}`, { code, stdout, stderr }));
    });
  });
}

/** systemctl is-active yang tidak melempar error saat service tidak ada. */
export async function serviceStatus(unit) {
  if (!COMMAND_WHITELIST.systemctl.allowedUnits.includes(unit)) return 'unknown';
  if (process.env.PANEL_DRY_RUN === '1') return 'unknown';
  try {
    const { stdout } = await runWhitelisted('systemctl', ['is-active', unit], { timeoutMs: 5000 });
    return stdout.trim() || 'unknown';
  } catch (err) {
    // Binary tidak terpasang di mesin ini — jangan berpura-pura tahu statusnya.
    if (String(err.message).includes('ENOENT')) return 'unknown';
    return 'inactive';
  }
}
