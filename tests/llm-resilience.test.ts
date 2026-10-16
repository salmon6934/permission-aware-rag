import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/jwt.js';
import { migratorPool } from '../src/db/pool.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { setEmbedder } from '../src/services/embedding/index.js';
import { FakeLLM } from '../src/services/llm/fakeLlm.js';
import { HostedLLM } from '../src/services/llm/hostedLlm.js';
import { setLLMProvider } from '../src/services/llm/index.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 5: LLM Resilience, Retry & Fail-Closed Tests', () => {
  let app: FastifyInstance;
  const fakeEmbedder = new FakeEmbedder();
  const fakeLlm = new FakeLLM();

  const tenantId = 'aaaaaaaa-9999-9999-9999-aaaaaaaaaaaa';
  const docId = 'daaaaaaa-9999-9999-9999-aaaaaaaaaaaa';

  const principal: Principal = {
    tenant_id: tenantId,
    user_id: 'alice_admin',
    roles: ['admin'],
    clearance: 3,
  };

  beforeAll(async () => {
    setEmbedder(fakeEmbedder);
    setLLMProvider(fakeLlm);

    app = buildApp();
    await app.ready();

    const client = await migratorPool.connect();
    try {
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'Resilience Test Tenant', '{}')
        ON CONFLICT (id) DO NOTHING;
      `);

      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES ('${docId}', '${tenantId}', 'resilience_test.txt', 'upload', ARRAY['admin'], 1, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      const text = 'Resilience test payload content.';
      const [vec] = await fakeEmbedder.embed([text]);
      await client.query(`
        INSERT INTO chunks (id, doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
        VALUES (gen_random_uuid(), '${docId}', '${tenantId}', ARRAY['admin'], 1, 1, 'fake-minilm-l6-v2', '${text}', '[${vec.join(',')}]')
        ON CONFLICT DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SET LOCAL app.allow_test_mutation = 'true';");
      await client.query(`DELETE FROM audit_events WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM chunks WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM documents WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
      await client.query('COMMIT;');
    } finally {
      client.release();
    }
    await app.close();
  });

  it('retries with exponential backoff on transient 429 rate limit errors and succeeds', async () => {
    const hostedLlm = new HostedLLM('gemini', 'fake-key');

    let attempts = 0;
    const transientOperation = async () => {
      attempts++;
      if (attempts <= 2) {
        const err = new Error('Rate limit exceeded');
        (err as Error & { status?: number }).status = 429;
        throw err;
      }
      return 'success';
    };

    const result = await hostedLlm.executeWithRetry(transientOperation, 3, 20);
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('fails closed when LLM experiences persistent failure, returning sanitized 503 and logging audit event', async () => {
    // Configure mock LLM to persistently fail
    fakeLlm.simulateTransientFailures(10, 503);

    const token = await signToken(principal);

    const res = await app.inject({
      method: 'POST',
      url: '/query',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        query: 'Resilience test query',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toBe('Service Unavailable');
    expect(body.message).toContain('temporarily unavailable');
    expect(body.request_id).toBeDefined();

    // Verify audit event logged failure with generation_occurred = false
    const client = await migratorPool.connect();
    try {
      const auditRes = await client.query(
        'SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1',
        [tenantId]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].generation_occurred).toBe(false);
      expect(auditRes.rows[0].applied_filter.error).toBeDefined();
    } finally {
      client.release();
    }
  });
});
