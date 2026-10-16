import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/jwt.js';
import { migratorPool } from '../src/db/pool.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { setEmbedder } from '../src/services/embedding/index.js';
import { FakeLLM } from '../src/services/llm/fakeLlm.js';
import { setLLMProvider } from '../src/services/llm/index.js';
import { FALLBACK_DENIAL_ANSWER } from '../src/services/promptBuilder.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 5: Query Endpoint & Citation Enforcement Integration Suite', () => {
  let app: FastifyInstance;
  const fakeEmbedder = new FakeEmbedder();
  const fakeLlm = new FakeLLM();

  const tenantId = '99999999-9999-9999-9999-999999999999';
  const docId = 'd9999999-9999-9999-9999-999999999999';

  const authorizedPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'alice_finance',
    roles: ['finance'],
    clearance: 2,
  };

  const unauthorizedPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'bob_sales',
    roles: ['sales'], // Not 'finance'
    clearance: 1,
  };

  beforeAll(async () => {
    setEmbedder(fakeEmbedder);
    setLLMProvider(fakeLlm);

    app = buildApp();
    await app.ready();

    const client = await migratorPool.connect();
    try {
      // 1. Seed tenant
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'Query Test Tenant', '{}')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 2. Seed finance document
      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES ('${docId}', '${tenantId}', 'q3_financial_allocations.txt', 'upload', ARRAY['finance'], 2, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 3. Seed chunk
      const text = 'Q3 corporate finance allocation reserves $4.2M for internal R&D cloud infrastructure.';
      const [vec] = await fakeEmbedder.embed([text]);
      await client.query(`
        INSERT INTO chunks (id, doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
        VALUES (gen_random_uuid(), '${docId}', '${tenantId}', ARRAY['finance'], 2, 1, 'fake-minilm-l6-v2', '${text}', '[${vec.join(',')}]')
        ON CONFLICT DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
      await client.query(`DELETE FROM audit_events WHERE tenant_id = '${tenantId}';`);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');
      await client.query(`DELETE FROM chunks WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM documents WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
    } finally {
      client.release();
    }
    await app.close();
  });

  it('generates grounded answer with doc_id and chunk_id citations for authorized queries', async () => {
    const token = await signToken(authorizedPrincipal);

    const res = await app.inject({
      method: 'POST',
      url: '/query',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        query: 'What is the Q3 corporate finance allocation?',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.answer).toContain('Based on authorized documentation');
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations[0].doc_id).toBe(docId);
    expect(body.citations[0].chunk_id).toBeDefined();
    expect(body.query_hash).toBeDefined();
    expect(body.request_id).toBeDefined();

    // Verify exactly one audit record written with generation_occurred = true
    const client = await migratorPool.connect();
    try {
      const auditRes = await client.query('SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1', [tenantId]);
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].generation_occurred).toBe(true);
      expect(auditRes.rows[0].returned_chunk_ids.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  it('returns uniform fallback denial response without calling LLM when unauthorized', async () => {
    const token = await signToken(unauthorizedPrincipal);
    const initialLlmCalls = fakeLlm.totalCalls;

    const res = await app.inject({
      method: 'POST',
      url: '/query',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        query: 'What is the Q3 corporate finance allocation?',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.answer).toBe(FALLBACK_DENIAL_ANSWER);
    expect(body.citations).toEqual([]);

    // LLM must NOT have been called (saving cost and preventing data leak)
    expect(fakeLlm.totalCalls).toBe(initialLlmCalls);

    // Verify audit entry written with generation_occurred = false
    const client = await migratorPool.connect();
    try {
      const auditRes = await client.query('SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1', [tenantId]);
      expect(auditRes.rows[0].generation_occurred).toBe(false);
      expect(auditRes.rows[0].returned_chunk_ids).toEqual([]);
    } finally {
      client.release();
    }
  });
});
