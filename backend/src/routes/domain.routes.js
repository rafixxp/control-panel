/**
 * Domain manager — CRUD domain + vHost Nginx.
 */
import { prisma } from '../config/database.js';
import { writeAudit } from '../services/audit.service.js';
import {
  createDomain,
  deleteDomain,
  readVhost,
  setSuspended,
  updateVhost,
} from '../services/nginx.service.js';
import { isValidDomain } from '../utils/pathGuard.js';

const createSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 3, maxLength: 253 },
    phpVersion: { type: 'string', enum: ['7.4', '8.1', '8.2', '8.3'], default: '8.2' },
    documentRoot: { type: 'string', maxLength: 512 },
    enableHttps: { type: 'boolean', default: false },
    redirectHttps: { type: 'boolean', default: true },
    gzip: { type: 'boolean', default: true },
    customDirectives: { type: 'string', maxLength: 4000, default: '' },
  },
};

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    phpVersion: { type: 'string', enum: ['7.4', '8.1', '8.2', '8.3'] },
    gzip: { type: 'boolean' },
    redirectHttps: { type: 'boolean' },
    customDirectives: { type: 'string', maxLength: 4000 },
    isSuspended: { type: 'boolean' },
  },
};

function withSsl(domain) {
  return {
    id: domain.id,
    name: domain.name,
    documentRoot: domain.documentRoot,
    phpVersion: domain.phpVersion,
    isSuspended: domain.isSuspended,
    createdAt: domain.createdAt,
    ssl: domain.ssl
      ? {
          id: domain.ssl.id,
          issuer: domain.ssl.issuer,
          status: domain.ssl.status,
          expiresAt: domain.ssl.expiresAt,
          autoRenew: domain.ssl.autoRenew,
          daysLeft: domain.ssl.expiresAt
            ? Math.ceil((domain.ssl.expiresAt - Date.now()) / 86_400_000)
            : null,
        }
      : null,
    subdomains: domain.subdomains?.length ?? 0,
  };
}

export default async function domainRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    const domains = await prisma.domain.findMany({
      orderBy: { createdAt: 'desc' },
      include: { ssl: true, subdomains: { select: { id: true } } },
    });
    return { domains: domains.map(withSsl) };
  });

  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const domain = await prisma.domain.findUnique({
      where: { id: Number(request.params.id) },
      include: { ssl: true, subdomains: true },
    });
    if (!domain) return reply.code(404).send({ error: 'not_found', message: 'Domain tidak ditemukan.' });
    return { domain: withSsl(domain) };
  });

  app.post('/', { preHandler: [app.authenticate], schema: { body: createSchema } }, async (request, reply) => {
    const body = request.body;
    const name = body.name.toLowerCase().trim();

    if (!isValidDomain(name)) {
      return reply.code(400).send({ error: 'invalid_domain', message: 'Format nama domain tidak valid.' });
    }
    const exists = await prisma.domain.findUnique({ where: { name } });
    if (exists) return reply.code(409).send({ error: 'conflict', message: 'Domain sudah terdaftar.' });

    try {
      const vhost = await createDomain({
        domain: name,
        phpVersion: body.phpVersion,
        documentRoot: body.documentRoot,
        gzip: body.gzip,
        customDirectives: body.customDirectives,
      });

      const domain = await prisma.domain.create({
        data: {
          name,
          documentRoot: vhost.documentRoot,
          phpVersion: body.phpVersion,
        },
      });

      // HTTPS diminta → terbitkan SSL lewat queue (inline bila tanpa Redis).
      if (body.enableHttps) {
        const { enqueueSslJob } = await import('../queues/ssl.queue.js');
        const { issue } = await import('../services/certbot.service.js');
        await enqueueSslJob('issue', { domain: name }, () => issue({ domain: name }));
      }

      await writeAudit(request, {
        action: 'CREATE_DOMAIN',
        resource: `domain:${name}`,
        detail: { phpVersion: body.phpVersion, enableHttps: Boolean(body.enableHttps) },
      });

      return reply.code(201).send({ domain: withSsl({ ...domain, ssl: null, subdomains: [] }), vhost });
    } catch (err) {
      await writeAudit(request, {
        action: 'CREATE_DOMAIN',
        resource: `domain:${name}`,
        status: 'failed',
        detail: { error: err.message },
      });
      throw err;
    }
  });

  app.patch('/:id', { preHandler: [app.authenticate], schema: { params: idParams(), body: updateSchema } }, async (request, reply) => {
    const domain = await prisma.domain.findUnique({ where: { id: Number(request.params.id) } });
    if (!domain) return reply.code(404).send({ error: 'not_found', message: 'Domain tidak ditemukan.' });

    const body = request.body;
    const changed = {};

    if (body.phpVersion && body.phpVersion !== domain.phpVersion) {
      await updateVhost({
        domain: domain.name,
        phpVersion: body.phpVersion,
        gzip: body.gzip,
        redirectHttps: body.redirectHttps,
        customDirectives: body.customDirectives,
        ssl: Boolean(domain.ssl),
      });
      changed.phpVersion = body.phpVersion;
    }

    if (typeof body.isSuspended === 'boolean' && body.isSuspended !== domain.isSuspended) {
      await setSuspended(domain.name, body.isSuspended);
      changed.isSuspended = body.isSuspended;
    }

    if (body.gzip !== undefined || body.customDirectives !== undefined || body.redirectHttps !== undefined) {
      await updateVhost({
        domain: domain.name,
        phpVersion: domain.phpVersion,
        gzip: body.gzip,
        redirectHttps: body.redirectHttps,
        customDirectives: body.customDirectives,
        ssl: Boolean(domain.ssl),
      });
    }

    const updated = await prisma.domain.update({
      where: { id: domain.id },
      data: changed,
      include: { ssl: true, subdomains: { select: { id: true } } },
    });

    await writeAudit(request, {
      action: 'UPDATE_DOMAIN',
      resource: `domain:${domain.name}`,
      detail: changed,
    });

    return { domain: withSsl(updated) };
  });

  app.get('/:id/vhost', { preHandler: [app.authenticate], schema: { params: idParams() } }, async (request, reply) => {
    const domain = await prisma.domain.findUnique({ where: { id: Number(request.params.id) } });
    if (!domain) return reply.code(404).send({ error: 'not_found', message: 'Domain tidak ditemukan.' });
    const vhost = await readVhost(domain.name);
    if (!vhost) return reply.code(404).send({ error: 'not_found', message: 'File vHost tidak ditemukan di disk.' });
    return { vhost };
  });

  app.delete(
    '/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        params: idParams(),
        querystring: {
          type: 'object',
          properties: { removeFiles: { type: 'boolean', default: false } },
        },
      },
    },
    async (request) => {
      const domain = await prisma.domain.findUnique({ where: { id: Number(request.params.id) } });
      if (!domain) return { deleted: false };

      const removeFiles = request.query?.removeFiles === true || request.query?.removeFiles === 'true';
      const result = await deleteDomain(domain.name, { removeFiles });
      await prisma.domain.delete({ where: { id: domain.id } });

      await writeAudit(request, {
        action: 'DELETE_DOMAIN',
        resource: `domain:${domain.name}`,
        detail: { removeFiles },
      });

      return { deleted: true, ...result };
    },
  );
}

function idParams() {
  return { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
}
