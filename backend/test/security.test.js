/**
 * Uji dua pilar keamanan Fase 1: chroot path guard & whitelist spawn.
 * Jalankan: npm test  (node --test)
 */
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../data/www');

process.env.PANEL_FILE_ROOTS = ROOT;

const { PathError, assertInsideRoots, assertRealPathInside, isValidDomain, isValidName } = await import(
  '../src/utils/pathGuard.js'
);
const { runWhitelisted } = await import('../src/utils/shell.js');

await fs.mkdir(ROOT, { recursive: true });

test('pathGuard: menolak path di luar chroot', () => {
  assert.throws(() => assertInsideRoots('/etc/passwd', [ROOT]), PathError);
  assert.throws(() => assertInsideRoots('/root/.ssh/id_rsa', [ROOT]), PathError);
  assert.throws(() => assertInsideRoots('/proc/self/mem', [ROOT]), PathError);
  assert.throws(() => assertInsideRoots('/var/www/../etc/shadow', [ROOT]), PathError);
});

test('pathGuard: menolak traversal & null byte', () => {
  assert.throws(() => assertInsideRoots(`${ROOT}/../rahasia.txt`, [ROOT]), PathError);
  assert.throws(() => assertInsideRoots(`${ROOT}\0/index.php`, [ROOT]), PathError);
  assert.throws(() => assertInsideRoots('', [ROOT]), PathError);
});

test('pathGuard: path di dalam root tetap diterima', async () => {
  const safe = await assertRealPathInside(`${ROOT}/./sub/..`, [ROOT]);
  assert.ok(safe.startsWith(ROOT), `${safe} harus berada di dalam ${ROOT}`);
});

test('pathGuard: symlink yang keluar dari root ditolak', async (t) => {
  const link = path.join(ROOT, 'escape-link');
  await fs.rm(link, { force: true });
  await fs.symlink('/etc', link).catch(() => t.skip('filesystem tidak mendukung symlink'));
  t.after(() => fs.rm(link, { force: true }));

  await assert.rejects(() => assertRealPathInside(link, [ROOT]), PathError);
});

test('validasi nama domain & nama file', () => {
  assert.ok(isValidDomain('example.com'));
  assert.ok(isValidDomain('sub.example.co.id'));
  assert.ok(!isValidDomain('exa mple.com'));
  assert.ok(!isValidDomain('example.com; rm -rf /'));
  assert.ok(!isValidDomain('-bad.com'));

  assert.ok(isValidName('index.php'));
  assert.ok(isValidName('my-file_2.tar.gz'));
  assert.ok(!isValidName('../up'));
  assert.ok(!isValidName('a/b'));
  assert.ok(!isValidName('..'));
});

test('shell: hanya binari whitelist yang boleh dieksekusi', async () => {
  await assert.rejects(() => runWhitelisted('bash', ['-c', 'echo hi']));
  await assert.rejects(() => runWhitelisted('/bin/sh', ['-c', 'id']));
  await assert.rejects(() => runWhitelisted('curl', ['http://example.com']));
});
