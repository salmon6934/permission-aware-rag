import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appPool, migratorPool } from '../src/db/pool.js';
import { withTenantTransaction } from '../src/db/tenantDb.js';

describe('Day 2: Connection Pool State Leakage Tests', () => {
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const docAId = 'a1111111-1111-1111-1111-111111111111';
  const chunkAId = 'a2222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    // Seed tenants and test data using migrator role
    const client = await migratorPool.connect();
    try {
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES 
          ('${tenantA}', 'Tenant Alpha Corp', '{"tier": "enterprise"}'),
          ('${tenantB}', 'Tenant Beta Inc', '{"tier": "standard"}')
        ON CONFLICT (id) DO NOTHING;
      `);

      await client.query(`
        INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
        VALUES 
          ('${docAId}', '${tenantA}', 'alpha_strategy.txt', 'upload', ARRAY['engineering', 'admin'], 1, 1, 'indexed')
        ON CONFLICT (id) DO NOTHING;
      `);

      // Dummy 384-dimensional vector string
      const dummyVec = `[${new Array(384).fill(0.01).join(',')}]`;
      await client.query(`
        INSERT INTO chunks (id, doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
        VALUES 
          ('${chunkAId}', '${docAId}', '${tenantA}', ARRAY['engineering', 'admin'], 1, 1, 'all-MiniLM-L6-v2', 'Alpha secret confidential chunk', '${dummyVec}')
        ON CONFLICT (id) DO NOTHING;
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

  it('guarantees transaction-local setting is cleared after COMMIT on the exact same client', async () => {
    const client = await appPool.connect();
    try {
      // Begin transaction with transaction-scoped config (is_local = true)
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

      // Setting must be active inside transaction
      const activeRes = await client.query<{ tenant: string }>(`SELECT current_setting('app.tenant_id', true) as tenant`);
      expect(activeRes.rows[0].tenant).toBe(tenantA);

      // Commit transaction
      await client.query('COMMIT');

      // Crucial test: on the EXACT SAME client connection, setting must now be empty
      const afterRes = await client.query<{ tenant: string }>(`SELECT current_setting('app.tenant_id', true) as tenant`);
      expect(afterRes.rows[0].tenant === '' || afterRes.rows[0].tenant === null).toBe(true);

      // Querying chunks without setting returns 0 rows (RLS fail-closed)
      const chunkRes = await client.query('SELECT * FROM chunks');
      expect(chunkRes.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it('guarantees transaction-local setting is cleared after ROLLBACK on the exact same client', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

      const activeRes = await client.query<{ tenant: string }>(`SELECT current_setting('app.tenant_id', true) as tenant`);
      expect(activeRes.rows[0].tenant).toBe(tenantA);

      await client.query('ROLLBACK');

      const afterRes = await client.query<{ tenant: string }>(`SELECT current_setting('app.tenant_id', true) as tenant`);
      expect(afterRes.rows[0].tenant === '' || afterRes.rows[0].tenant === null).toBe(true);
    } finally {
      client.release();
    }
  });

  it('isolates tenants when executing through withTenantTransaction', async () => {
    // Under Tenant A: can see Tenant A chunk
    const chunksA = await withTenantTransaction(tenantA, async (client) => {
      const res = await client.query('SELECT id, text FROM chunks WHERE id = $1', [chunkAId]);
      return res.rows;
    });
    expect(chunksA.length).toBe(1);
    expect(chunksA[0].id).toBe(chunkAId);

    // Under Tenant B: cannot see Tenant A chunk (returns 0 rows)
    const chunksB = await withTenantTransaction(tenantB, async (client) => {
      const res = await client.query('SELECT id, text FROM chunks WHERE id = $1', [chunkAId]);
      return res.rows;
    });
    expect(chunksB.length).toBe(0);
  });

  it('fails closed when withTenantTransaction is called with an invalid UUID', async () => {
    await expect(
      withTenantTransaction('invalid-uuid-format', async (client) => {
        return client.query('SELECT 1');
      })
    ).rejects.toThrow();
  });
});
