/**
 * SSL manager — issue, renew, revoke, upload manual, auto-renew.
 */
import { prisma } from '../config/database.js';
import { writeAudit } from '../services/audit.service.js';
import { issue, renew, revoke, sslSummary, uploadManual } from '../services/certbot.service.js';
import { enqueueSslJob } from '../queues/ssl.queue.js';

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };

const manualSchema = {
  type: 'object',
  required: ['domainId', 'certificate', 'privateKey'],
  additionalProperties: false,
  properties: {
    domainId: { type: 'integer' },
    certificate: { type: 'string', minLength: 40, maxLength: 20_000 },
    privateKey: { type: 'string', minLength: 40, maxLength: 20_000 },
  },
};

export default async function sslRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    const certs = await prisma.ssl.findMany({
      orderBy: { expiresAt: 'asc' },
      include: { domain: { select: { name: true, documentRoot: true } } },
    });
    return { certificates: certs.map(sslSummary) };
  });

  app.post(
    '/issue',
    {
      preHandler: [app.authenticate, app.authorize('ADMIN')],
      schema: {
        body: {
          type: 'object',
          required: ['domainId'],
          additionalProperties: false,
          properties: { domainId: { type: 'integer' } },
        },
      },
    },
    async (request) => {
      const domain = await prisma.domain.findUnique({
        where: { id: request.body.domainId },
        include: { ssl: true },
      });
      if (!domain) return { ok: false, message: 'Domain tidak ditemukan.' };

      const job = await enqueueSslJob('issue', { domain: domain.name }, () =>
        issue({ domain: domain.name }),
      );

      const cert = job.result ?? {
        issuer: 'letsencrypt',
        status: 'pending',
        expiresAt: null,
      };

      const ssl = await prisma.ssl.upsert({
        where: { domainId: domain.id },
        update: { issuer: cert.issuer, status: cert.status, expiresAt: cert.expiresAt },
        create: {
          domainId: domain.id,
          issuer: cert.issuer,
          status: cert.status,
          expiresAt: cert.expiresAt,
        },
      });

      await writeAudit(request, {
        action: 'ISSUE_SSL',
        resource: `domain:${domain.name}`,
        detail: { issuer: cert.issuer, status: cert.status, jobId: job.jobId ?? null },
      });

      return { ok: true, certificate: sslSummary({ ...ssl, domain }) };
    },
  );

  app.post('/:id/renew', { preHandler: [app.authenticate, app.authorize('ADMIN')], schema: { params: idParams } }, async (request) => {
    const ssl = await prisma.ssl.findUnique({ where: { id: Number(request.params.id) }, include: { domain: true } });
    if (!ssl) return { ok: false, message: 'Sertifikat tidak ditemukan.' };

    const result = await renew({ domain: ssl.domain.name });
    const updated = await prisma.ssl.update({
      where: { id: ssl.id },
      data: { status: result.status, expiresAt: result.expiresAt ?? ssl.expiresAt },
    });

    await writeAudit(request, { action: 'RENEW_SSL', resource: `domain:${ssl.domain.name}` });
    return { ok: true, certificate: sslSummary({ ...updated, domain: ssl.domain }) };
  });

  app.post('/:id/revoke', { preHandler: [app.authenticate, app.authorize('ADMIN')], schema: { params: idParams } }, async (request) => {
    const ssl = await prisma.ssl.findUnique({ where: { id: Number(request.params.id) }, include: { domain: true } });
    if (!ssl) return { ok: false, message: 'Sertifikat tidak ditemukan.' };

    await revoke({ domain: ssl.domain.name });
    await prisma.ssl.delete({ where: { id: ssl.id } }).catch(() => {});

    await writeAudit(request, { action: 'REVOKE_SSL', resource: `domain:${ssl.domain.name}` });
    return { ok: true };
  });

  app.patch('/:id', { preHandler: [app.authenticate], schema: { params: idParams, body: { type: 'object', properties: { autoRenew: { type: 'boolean' } } } } }, async (request) => {
    const ssl = await prisma.ssl.update({
      where: { id: Number(request.params.id) },
      data: { autoRenew: Boolean(request.body.autoRenew) },
      include: { domain: { select: { name: true } } },
    });
    return { certificate: sslSummary(ssl) };
  });

  app.post('/manual', { preHandler: [app.authenticate, app.authorize('ADMIN')], schema: { body: manualSchema } }, async (request) => {
    const domain = await prisma.domain.findUnique({ where: { id: request.body.domainId } });
    if (!domain) return { ok: false, message: 'Domain tidak ditemukan.' };

    const cert = await uploadManual({
      domain: domain.name,
      certificate: request.body.certificate,
      privateKey: request.body.privateKey,
    });

    const ssl = await prisma.ssl.upsert({
      where: { domainId: domain.id },
      update: { issuer: cert.issuer, status: cert.status, expiresAt: cert.expiresAt },
      create: {
        domainId: domain.id,
        issuer: cert.issuer,
        status: cert.status,
        expiresAt: cert.expiresAt,
      },
    });

    await writeAudit(request, {
      action: 'UPLOAD_SSL',
      resource: `domain:${domain.name}`,
      detail: { issuer: 'custom' },
    });

    return { ok: true, certificate: sslSummary({ ...ssl, domain }) };
  });
}
