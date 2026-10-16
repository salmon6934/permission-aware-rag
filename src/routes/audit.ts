import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/authHook.js';
import { requireRole } from '../auth/guards.js';
import { getAuditLogs, verifyAuditChain } from '../services/auditLogger.js';

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // Get paginated audit logs for tenant (requires 'admin')
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/audit',
    {
      preHandler: [authenticate, requireRole(['admin'])],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { limit, offset } = AuditQuerySchema.parse(request.query);
      const events = await getAuditLogs(principal.tenant_id, limit, offset);

      return reply.status(200).send({
        tenant_id: principal.tenant_id,
        limit,
        offset,
        count: events.length,
        events,
      });
    }
  );

  // Verify tenant cryptographic hash chain (requires 'admin')
  app.get(
    '/audit/verify',
    {
      preHandler: [authenticate, requireRole(['admin'])],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const result = await verifyAuditChain(principal.tenant_id);

      if (!result.valid) {
        return reply.status(409).send({
          valid: false,
          message: 'Cryptographic audit hash chain verification failed: tampering detected',
          details: result,
        });
      }

      return reply.status(200).send({
        valid: true,
        tenant_id: principal.tenant_id,
        total_events: result.totalEvents,
        message: 'Cryptographic hash chain is intact and fully verified from genesis.',
      });
    }
  );
}
