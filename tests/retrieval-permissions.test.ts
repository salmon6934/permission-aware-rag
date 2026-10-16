import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratorPool } from '../src/db/pool.js';
import { retrieveChunks } from '../src/services/retrieval.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 4: Permission-Aware Filtered Retrieval Tests', () => {
  const tenantA = '55555555-5555-5555-5555-555555555555';
  const tenantB = '66666666-6666-6666-6666-666666666666';

  const docA1Id = 'd5555555-1111-1111-1111-111111111111';
  const docA2Id = 'd5555555-2222-2222-2222-222222222222';
  const docBId = 'd6666666-1111-1111-1111-111111111111';

  const embedder = new FakeEmbedder();

  // Test personas
  const engClearance1User: Principal = {
    tenant_id: tenantA,
    user_id: 'alice_eng',
    roles: ['engineering'],
    clearance: 1,
  };

  const financeClearance2User: Principal = {
    tenant_id: tenantA,
    user_id: 'bob_fin',
    roles: ['finance'],
    clearance: 2,
  };

  const publicUser: Principal = {
    tenant_id: tenantA,
    user_id: 'guest',
    roles: ['public'],
    clearance: 0,
  };

  const tenantBUser: Principal = {
    tenant_id: tenantB,
    user_id: 'charlie_b',
    roles: ['engineering', 'finance', 'admin'],
    clearance: 3,
  };

  beforeAll(async () => {
    const client = await migratorPool.connect();
    try {
      // 1. Seed tenants
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES 
          ('${tenantA}', 'Retrieval Test Alpha', '{}'),
          ('${tenantB}', 'Retrieval Test Beta', '{}')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 2. Seed documents for Tenant A
      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES 
          ('${docA1Id}', '${tenantA}', 'eng_public.txt', 'upload', ARRAY['engineering', 'public'], 0, 1, 'indexed'),
          ('${docA2Id}', '${tenantA}', 'finance_secret.txt', 'upload', ARRAY['finance'], 2, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 3. Seed document for Tenant B
      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES 
          ('${docBId}', '${tenantB}', 'tenant_b_doc.txt', 'upload', ARRAY['engineering', 'finance'], 1, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 4. Seed chunks with deterministic vectors
      const [vec1] = await embedder.embed(['Cloud infrastructure architecture public overview']);
      const [vec2] = await embedder.embed(['Confidential quarterly finance allocations and budget']);
      const [vecB] = await embedder.embed(['Tenant B proprietary cloud infrastructure notes']);

      await client.query(`
        INSERT INTO chunks (id, doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
        VALUES 
          (gen_random_uuid(), '${docA1Id}', '${tenantA}', ARRAY['engineering', 'public'], 0, 1, 'fake-minilm-l6-v2', 'Cloud infrastructure architecture public overview', '[${vec1.join(',')}]'),
          (gen_random_uuid(), '${docA2Id}', '${tenantA}', ARRAY['finance'], 2, 1, 'fake-minilm-l6-v2', 'Confidential quarterly finance allocations and budget', '[${vec2.join(',')}]'),
          (gen_random_uuid(), '${docBId}', '${tenantB}', ARRAY['engineering', 'finance'], 1, 1, 'fake-minilm-l6-v2', 'Tenant B proprietary cloud infrastructure notes', '[${vecB.join(',')}]')
        ON CONFLICT DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query(`DELETE FROM chunks WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
      await client.query(`DELETE FROM documents WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
      await client.query(`DELETE FROM tenants WHERE id IN ('${tenantA}', '${tenantB}');`);
    } finally {
      client.release();
    }
  });

  it('enforces RBAC: engineering user cannot retrieve finance-only chunks', async () => {
    const results = await retrieveChunks({
      query: 'quarterly finance budget',
      principal: engClearance1User,
      embedder,
    });

    // Should not see finance chunk
    const hasFinance = results.some((r) => r.allowed_roles.includes('finance') && !r.allowed_roles.includes('engineering'));
    expect(hasFinance).toBe(false);
  });

  it('enforces Clearance: clearance 0 user only retrieves sensitivity 0 chunks', async () => {
    const results = await retrieveChunks({
      query: 'cloud architecture',
      principal: publicUser,
      embedder,
    });

    for (const chunk of results) {
      expect(chunk.sensitivity).toBe(0);
    }
  });

  it('allows finance user with clearance 2 to retrieve finance confidential chunks', async () => {
    const results = await retrieveChunks({
      query: 'quarterly finance budget',
      principal: financeClearance2User,
      embedder,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].allowed_roles).toContain('finance');
    expect(results[0].sensitivity).toBeLessThanOrEqual(2);
    expect(results[0].similarity).toBeGreaterThan(0);
  });

  it('strictly isolates tenants: Tenant B user never retrieves Tenant A chunks', async () => {
    const results = await retrieveChunks({
      query: 'cloud infrastructure overview',
      principal: tenantBUser,
      embedder,
    });

    for (const chunk of results) {
      expect(chunk.doc_id).toBe(docBId);
      expect(chunk.doc_id).not.toBe(docA1Id);
      expect(chunk.doc_id).not.toBe(docA2Id);
    }
  });
});
