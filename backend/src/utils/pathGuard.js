/**
 * Path traversal guard — semua operasi File Manager wajib melewati sini.
 *
 * - Path dinormalisasi (tanpa ../, tanpa null byte)
 * - Harus berada di dalam salah satu root yang diizinkan (chroot)
 * - Direktori terlarang (/etc, /root, /proc, ...) diblokir meski di dalam root
 * - Symlink tidak diikuti bila targetnya keluar dari root
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const BLOCKED_SEGMENTS = new Set([
  'etc', 'root', 'proc', 'sys', 'bin', 'usr', 'sbin', 'lib', 'lib64',
  'dev', 'run', 'boot', 'var/lib', 'snap',
]);

export class PathError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PathError';
    this.status = status;
  }
}

function hasTraversal(input) {
  if (typeof input !== 'string') return true;
  if (input.includes('\0')) return true;
  const normalized = path.posix.normalize(input);
  return normalized.split('/').includes('..');
}

/**
 * Validasi path absolut terhadap daftar root yang diizinkan.
 * @param {string} input path absolut (mis. /var/www/example.com/public/index.php)
 * @param {string[]} roots daftar root chroot
 * @returns {string} path ternormalisasi yang aman
 */
export function assertInsideRoots(input, roots) {
  if (typeof input !== 'string' || !input.trim()) throw new PathError('Path kosong.');
  if (hasTraversal(input)) throw new PathError('Path mengandung traversal (..).');

  const resolved = path.resolve(input);
  const rel = path.relative(path.parse(resolved).root, resolved);
  for (const segment of rel.split(path.sep)) {
    if (BLOCKED_SEGMENTS.has(segment)) throw new PathError(`Akses ke ${segment} diblokir.`, 403);
  }

  const allowed = roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
    if (!allowed) {
    throw new PathError('Path berada di luar chroot panel.', 403);
  }

  return resolved;
}

/**
 * Validasi path relatif terhadap sebuah root (mis. query ?path=index.php).
 */
export function resolveInside(root, relativePath = '') {
  if (hasTraversal(relativePath)) throw new PathError('Path mengandung traversal (..).');
  const resolved = path.resolve(path.resolve(root), relativePath);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new PathError('Path keluar dari direktori yang diizinkan.', 403);
  }
  return resolved;
}

/**
 * Validasi path final termasuk target symlink — pastikan symlink tidak
 * mengarah keluar dari root (symlink-follow escape).
 */
export async function assertRealPathInside(input, roots) {
  const safe = assertInsideRoots(input, roots);
  try {
    const real = await fs.realpath(safe);
    assertInsideRoots(real, roots);
    return real;
  } catch (err) {
    if (err instanceof PathError) throw err;
    // Belum ada di disk — kembalikan path aman yang sudah divalidasi.
    return safe;
  }
}

/** Regex validasi nama domain (whitelist [a-zA-Z0-9.-]). */
const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/;

export function isValidDomain(value) {
  return typeof value === 'string' && value.length <= 253 && DOMAIN_RE.test(value);
}

/** Nama file/folder aman (tanpa path separator). */
const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function isValidName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && SAFE_NAME_RE.test(value) && value !== '.' && value !== '..';
}
