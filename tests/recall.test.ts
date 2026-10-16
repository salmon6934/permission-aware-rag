import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratorPool } from '../src/db/pool.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { withTenantTransaction } from '../src/db/tenantDb.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 4: Quantitative HNSW Recall Test Suite', () => {
  const tenantId = '88888888-8888-8888-8888-888888888888';
  const docId = 'd8888888-8888-8888-8888-888888888888';
  const embedder = new FakeEmbedder();

  const principal: Principal = {
    tenant_id: tenantId,
    user_id: 'recall_test_user',
    roles: ['engineering', 'member'],
    clearance: 2,
  };

  const TOTAL_CHUNKS = 120;
  const TOP_K = 10;

  beforeAll(async () => {
    const client = await migratorPool.connect();
    try {
      // 1. Seed tenant
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'Recall Test Tenant', '{}')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 2. Seed document
      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES ('${docId}', '${tenantId}', 'knowledge_corpus.txt', 'upload', ARRAY['engineering', 'member', 'admin', 'finance'], 3, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 3. Generate 120 chunks with varied text and roles
      const rolesPool = [
        ['engineering'],
        ['finance'],
        ['engineering', 'member'],
        ['admin'],
        ['member'],
        ['hr'],
      ];

      const chunkValues: string[] = [];
      const queryParams: unknown[] = [];
      let paramCounter = 1;

      for (let i = 0; i < TOTAL_CHUNKS; i++) {
        const text = `Document chunk ${i}: Enterprise topic regarding distributed databases, caching, authorization patterns, and vector mathematics token index ${i * 7}.`;
        const [vector] = await embedder.embed([text]);
        const vectorStr = `[${vector.join(',')}]`;
        const roles = rolesPool[i % rolesPool.length];
        const sensitivity = i % 4; // 0, 1, 2, 3

        chunkValues.push(
          `($${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4}, $${paramCounter + 5}, $${paramCounter + 6}, $${paramCounter + 7})`
        );

        queryParams.push(
          docId,
          tenantId,
          roles,
          sensitivity,
          1,
          'fake-minilm-l6-v2',
          text,
          vectorStr
        );

        paramCounter += 8;
      }

      const insertSql = `
        INSERT INTO chunks (
          doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding
        ) VALUES ${chunkValues.join(', ')};
      `;

      await client.query(insertSql, queryParams);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query(`DELETE FROM chunks WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM documents WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
    } finally {
      client.release();
    }
  });

  it('validates HNSW index recall >= 95% compared against brute-force exact scan', async () => {
    const queryText = 'distributed databases and vector authorization patterns';
    const [queryVec] = await embedder.embed([queryText]);
    const queryVecStr = `[${queryVec.join(',')}]`;

    // 1. Run Ground-Truth Brute Force Scan (disable index scans to force exact distance computation)
    const groundTruthIds = await withTenantTransaction(tenantId, async (client) => {
      await client.query('SET LOCAL enable_indexscan = off;');
      await client.query('SET LOCAL enable_bitmapscan = off;');

      const res = await client.query<{ id: string }>(
        `
        SELECT id
        FROM chunks
        WHERE tenant_id = $1
          AND allowed_roles && $2
          AND sensitivity <= $3
        ORDER BY embedding <=> $4
        LIMIT $5;
        `,
        [tenantId, principal.roles, principal.clearance, queryVecStr, TOP_K]
      );

      return res.rows.map((r) => r.id);
    });

    expect(groundTruthIds.length).toBe(TOP_K);

    // 2. Run HNSW Index Query with ef_search = 100
    const hnswIds = await withTenantTransaction(tenantId, async (client) => {
      await client.query('SET LOCAL hnsw.ef_search = 100;');
      await client.query('SET LOCAL enable_indexscan = on;');

      const res = await client.query<{ id: string }>(
        `
        SELECT id
        FROM chunks
        WHERE tenant_id = $1
          AND allowed_roles && $2
          AND sensitivity <= $3
        ORDER BY embedding <=> $4
        LIMIT $5;
        `,
        [tenantId, principal.roles, principal.clearance, queryVecStr, TOP_K]
      );

      return res.rows.map((r) => r.id);
    });

    expect(hnswIds.length).toBe(TOP_K);

    // 3. Compute Intersection Recall
    const intersection = hnswIds.filter((id) => groundTruthIds.includes(id));
    const recall = (intersection.length / TOP_K) * 100;

    console.log(`\nQuantitative Recall: ${recall.toFixed(1)}% (${intersection.length}/${TOP_K} matches)`);

    // Must satisfy completion criteria: recall >= 95%
    expect(recall).toBeGreaterThanOrEqual(95);
  });
});
