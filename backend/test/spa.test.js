import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const frontendDistDir = path.resolve(import.meta.dirname, '../../frontend/dist');
const indexFile = path.join(frontendDistDir, 'index.html');

await fs.mkdir(frontendDistDir, { recursive: true });
await fs.writeFile(indexFile, '<!doctype html><html><body><div id="app"></div></body></html>');

test('SPA: route non-API mengembalikan HTML app', async () => {
  const { buildApp } = await import('../app.js');
  const app = await buildApp();

  const response = await app.inject({
    method: 'GET',
    url: '/login',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /<div id="app"><\/div>/);

  await app.close();
});
