/**
 * File manager — operasi dibatasi chroot (PANEL_FILE_ROOTS).
 * Upload dibatasi ekstensi whitelist dan MAX_UPLOAD_MB.
 */
import path from 'node:path';
import { env } from '../config/env.js';
import { writeAudit } from '../services/audit.service.js';
import {
  assertUploadable,
  listDir,
  makeDir,
  readText,
  remove,
  rename,
  search,
  streamFile,
  writeText,
} from '../services/file.service.js';
import { PathError, assertRealPathInside } from '../utils/pathGuard.js';

const idQuery = {
  type: 'object',
  required: ['path'],
  properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } },
};

function safePath(request) {
  return assertRealPathInside(request.query.path, env.fileRoots);
}

export default async function fileRoutes(app) {
  app.get('/roots', { preHandler: [app.authenticate] }, async () => ({
    roots: env.fileRoots,
    maxUploadMb: env.maxUploadMb,
  }));

  app.get(
    '/list',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            showHidden: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request) => {
      const target = await safePath(request);
      return listDir(target, { showHidden: Boolean(request.query.showHidden) });
    },
  );

  app.get('/read', { preHandler: [app.authenticate], schema: { querystring: idQuery } }, async (request) => {
    const target = await safePath(request);
    return readText(target);
  });

  app.put(
    '/write',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['path', 'content'],
          additionalProperties: false,
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            content: { type: 'string', maxLength: 2 * 1024 * 1024 },
          },
        },
      },
    },
    async (request) => {
      const target = assertRealPathInside(request.body.path, env.fileRoots);
      const result = await writeText(target, request.body.content);
      await writeAudit(request, { action: 'WRITE_FILE', resource: `file:${target}`, detail: { size: result.size } });
      return result;
    },
  );

  app.get('/download', { preHandler: [app.authenticate], schema: { querystring: idQuery } }, async (request, reply) => {
    const target = await safePath(request);
    const { stream } = await streamFile(target);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(target)}"`);
    return reply.send(stream);
  });

  app.post(
    '/mkdir',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['path', 'name'],
          additionalProperties: false,
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            name: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    async (request) => {
      const base = await assertRealPathInside(request.body.path, env.fileRoots);
      const created = await makeDir(base, request.body.name);
      await writeAudit(request, { action: 'MKDIR', resource: `file:${created}` });
      return { path: created };
    },
  );

  app.post(
    '/rename',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['path', 'name'],
          additionalProperties: false,
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            name: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    async (request) => {
      const source = await assertRealPathInside(request.body.path, env.fileRoots);
      const target = await rename(source, request.body.name);
      await writeAudit(request, { action: 'RENAME', resource: `file:${source}`, detail: { to: target } });
      return { path: target };
    },
  );

  app.delete('/', { preHandler: [app.authenticate], schema: { querystring: idQuery } }, async (request) => {
    const target = await safePath(request);
    const roots = env.fileRoots;
    const isRoot = roots.includes(target);
    if (isRoot) throw new PathError('Tidak boleh menghapus direktori root.', 403);

    await remove(target);
    await writeAudit(request, { action: 'DELETE_FILE', resource: `file:${target}` });
    return { deleted: true, path: target };
  });

  app.post(
    '/upload',
    {
      preHandler: [app.authenticate],
      schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } },
    },
    async (request) => {
      const base = await assertRealPathInside(request.query.path, env.fileRoots);
      const uploaded = [];
      const errors = [];

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type !== 'file') continue;
        try {
          assertUploadable(part.filename);
          const target = path.join(base, part.filename);
          await part.toFile(target);
          uploaded.push({ name: part.filename, path: target, size: part.file.bytesRead });
          await writeAudit(request, { action: 'UPLOAD_FILE', resource: `file:${target}`, detail: { size: part.file.bytesRead } });
        } catch (err) {
          errors.push({ name: part.filename, error: err.message });
        }
      }

      if (uploaded.length === 0 && errors.length > 0) {
        return { uploaded, errors, ok: false };
      }
      return { uploaded, errors, ok: uploaded.length > 0 };
    },
  );

  app.get(
    '/search',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          required: ['path', 'q'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            q: { type: 'string', minLength: 1, maxLength: 200 },
            recursive: { type: 'boolean', default: true },
          },
        },
      },
    },
    async (request) => {
      const base = await safePath(request);
      const results = await search(base, request.query.q, { recursive: request.query.recursive !== false });
      return { results };
    },
  );
}
