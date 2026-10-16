import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/authHook.js';
import { retrieveChunks } from '../services/retrieval.js';
import { buildPrompt, FALLBACK_DENIAL_ANSWER } from '../services/promptBuilder.js';
import { getLLMProvider } from '../services/llm/index.js';
import { recordAuditEvent, computeQueryHash } from '../services/auditLogger.js';

const QueryBodySchema = z.object({
  query: z.string().min(1, { message: 'query cannot be empty' }),
  limit: z.number().int().min(1).max(20).optional().default(5),
});

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/query',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parseResult = QueryBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.errors[0]?.message || 'Invalid query payload',
        });
      }

      const { query, limit } = parseResult.data;
      const requestId = `req-${crypto.randomUUID().slice(0, 8)}`;
      const queryHash = computeQueryHash(query);

      try {
        // 1. Filtered vector retrieval (in-query permission enforcement)
        const chunks = await retrieveChunks({
          query,
          principal,
          limit,
        });

        // 2. If no chunks authorized / found: fail closed uniformly without calling LLM
        if (chunks.length === 0) {
          await recordAuditEvent({
            tenantId: principal.tenant_id,
            principal,
            query,
            requestId,
            returnedChunkIds: [],
            aclVersions: [],
            generationOccurred: false,
          });

          return reply.status(200).send({
            answer: FALLBACK_DENIAL_ANSWER,
            citations: [],
            query_hash: queryHash,
            request_id: requestId,
          });
        }

        // 3. Build prompt with isolated untrusted context blocks
        const prompt = buildPrompt(query, chunks);
        const llm = getLLMProvider();

        let llmResponse;
        try {
          llmResponse = await llm.generateAnswer(prompt);
        } catch (llmErr) {
          // LLM failure after retries -> audit failure and fail closed
          request.log.error(llmErr, 'LLM generation failed after retries');

          await recordAuditEvent({
            tenantId: principal.tenant_id,
            principal,
            query,
            requestId,
            returnedChunkIds: chunks.map((c) => c.id),
            aclVersions: chunks.map((c) => c.acl_version),
            generationOccurred: false,
            error: llmErr instanceof Error ? llmErr.message : 'LLM failure',
          });

          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Language model generation service is temporarily unavailable. Please try again.',
            request_id: requestId,
          });
        }

        // 4. Audit successful generation event
        await recordAuditEvent({
          tenantId: principal.tenant_id,
          principal,
          query,
          requestId,
          returnedChunkIds: chunks.map((c) => c.id),
          aclVersions: chunks.map((c) => c.acl_version),
          generationOccurred: true,
        });

        return reply.status(200).send({
          answer: llmResponse.answer,
          model: llmResponse.model,
          citations: chunks.map((c) => ({
            doc_id: c.doc_id,
            chunk_id: c.id,
            similarity: c.similarity,
          })),
          query_hash: queryHash,
          request_id: requestId,
        });
      } catch (err) {
        request.log.error(err, 'Unhandled query pipeline error');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred while processing your request.',
          request_id: requestId,
        });
      }
    }
  );
}
