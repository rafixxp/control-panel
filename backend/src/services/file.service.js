/**
 * File service — operasi file manager yang dibatasi chroot.
 * Tidak ada operasi yang mengikuti symlink keluar dari root.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { env } from '../config/env.js';
import { assertRealPathInside, isValidName, PathError, resolveInside } from '../utils/pathGuard.js';

const BLOCKED_EXTENSIONS = new Set([
  '.sh', '.bash', '.exe', '.dll', '.so', '.bin', '.run', '.deb', '.rpm', '.ko',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.html', '.htm', '.css', '.js', '.mjs', '.json', '.xml', '.yml', '.yaml',
  '.php', '.conf', '.ini', '.log', '.env', '.sql', '.csv', '.svg', '.vue', '.ts',
]);

const ICON_BY_EXT = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'],
  pdf: ['.pdf'],
  archive: ['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z'],
  code: ['.js', '.mjs', '.ts', '.php', '.py', '.vue', '.sh', '.json', '.yml', '.yaml'],
  style: ['.css', '.scss', '.less'],
  doc: ['.txt', '.md', '.doc', '.docx'],
};

export function iconFor(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [icon, exts] of Object.entries(ICON_BY_EXT)) {
    if (exts.includes(ext)) return icon;
  }
  return 'file';
}

function assertAllowedRoot(target) {
  const ok = env.fileRoots.some((root) => target === root || target.startsWith(root + path.sep));
  if (!ok) throw new PathError('Path berada di luar chroot panel.', 403);
  return target;
}

export async function listDir(dirPath, { showHidden = false } = {}) {
  const target = await assertRealPathInside(dirPath, env.fileRoots);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) continue;
    const full = path.join(target, entry.name);
    const stat = await fs.lstat(full).catch(() => null);
    if (!stat) continue;
    items.push({
      name: entry.name,
      path: full,
      type: stat.isDirectory() ? 'dir' : stat.isSymbolicLink() ? 'link' : 'file',
      size: stat.size,
      modifiedAt: stat.mtime,
      icon: stat.isDirectory() ? 'folder' : iconFor(entry.name),
      hidden: entry.name.startsWith('.'),
      readOnly: !(stat.mode & 0o200),
    });
  }

  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return {
    path: target,
    parent: path.dirname(target),
    items,
  };
}

export async function makeDir(baseDir, name) {
  if (!isValidName(name)) throw new PathError('Nama folder tidak valid (huruf, angka, . _ -).');
  const target = resolveInside(baseDir, name);
  assertAllowedRoot(target);
  await fs.mkdir(target, { recursive: false });
  return target;
}

export async function rename(fromPath, toName) {
  if (!isValidName(toName)) throw new PathError('Nama file tidak valid (huruf, angka, . _ -).');
  const source = await assertRealPathInside(fromPath, env.fileRoots);
  const target = assertAllowedRoot(path.join(path.dirname(source), toName));
  await fs.rename(source, target);
  return target;
}

export async function remove(targetPath) {
  const target = await assertRealPathInside(targetPath, env.fileRoots);
  assertAllowedRoot(target);
  const stat = await fs.lstat(target);
  await fs.rm(target, { recursive: stat.isDirectory(), force: false });
  return target;
}

export async function readText(targetPath) {
  const target = await assertRealPathInside(targetPath, env.fileRoots);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) throw new PathError('Ini adalah direktori.', 400);
  if (stat.size > 2 * 1024 * 1024) throw new PathError('File terlalu besar untuk diedit (>2MB).', 413);
  const content = await fs.readFile(target, 'utf8');
  return { path: target, size: stat.size, modifiedAt: stat.mtime, content, editable: TEXT_EXTENSIONS.has(path.extname(target).toLowerCase()) };
}

export async function writeText(targetPath, content) {
  const target = assertAllowedRoot(path.resolve(targetPath));
  await fs.writeFile(target, String(content), 'utf8');
  const stat = await fs.stat(target);
  return { path: target, size: stat.size, modifiedAt: stat.mtime };
}

export function streamFile(targetPath) {
  return assertRealPathInside(targetPath, env.fileRoots).then((target) => ({
    stream: createReadStream(target),
    path: target,
  }));
}

const UPLOAD_WHITELIST = [
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.xml', '.yml', '.yaml',
  '.php', '.ini', '.conf', '.log', '.sql', '.csv', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.woff', '.woff2',
  '.ttf', '.eot', '.map', '.vue', '.ts',
];

export function assertUploadable(filename) {
  if (!isValidName(filename)) throw new PathError('Nama file tidak valid.');
  const ext = path.extname(filename).toLowerCase();
  if (!UPLOAD_WHITELIST.includes(ext)) {
    throw new PathError(`Ekstensi ${ext || '(tanpa ekstensi)'} tidak diizinkan diunggah.`, 415);
  }
  if (BLOCKED_EXTENSIONS.has(ext)) throw new PathError(`Ekstensi ${ext} diblokir.`, 415);
  return filename;
}

export async function search(baseDir, query, { recursive = true, limit = 200 } = {}) {
  const target = await assertRealPathInside(baseDir, env.fileRoots);
  const needle = String(query || '').toLowerCase();
  if (!needle) return [];
  const results = [];

  async function walk(dir, depth = 0) {
    if (results.length >= limit || depth > 8) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(needle)) {
        results.push({ name: entry.name, path: full, type: entry.isDirectory() ? 'dir' : 'file' });
      }
      if (recursive && entry.isDirectory()) await walk(full, depth + 1);
    }
  }

  await walk(target);
  return results;
}
