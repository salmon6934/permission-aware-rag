import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratorPool, appPool, assertRuntimeRolePrivileges } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';

describe('Day 1: PostgreSQL Row Level Security (RLS) Isolation & Privilege Hardening', () => {
  const tenantAId = '11111111-1111-1111-1111-111111111111';
  const tenantBId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    // 1. Ensure migrations are up to date
    await runMigrations();

    // 2. Clean up and seed test data using migrator pool
    const client = await migratorPool.connect();
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
      await client.query('DELETE FROM audit_events WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
      await client.query('DELETE FROM tenants WHERE id IN ($1, $2);', [tenantAId, tenantBId]);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');

      // Seed Tenant A
      await client.query(
        `INSERT INTO tenants (id, name, config) VALUES ($1, $2, $3);`,
        [tenantAId, 'Tenant Alpha Corp', JSON.stringify({ retention_days: 90 })],
      );

      // Seed Tenant B
      await client.query(
        `INSERT INTO tenants (id, name, config) VALUES ($1, $2, $3);`,
        [tenantBId, 'Tenant Beta Ltd', JSON.stringify({ retention_days: 30 })],
      );

      // Seed Document & Chunk for Tenant A
      const docARes = await client.query(
        `INSERT INTO documents (tenant_id, filename, source, allowed_roles, sensitivity)
         VALUES ($1, 'alpha_doc.txt', 'upload', ARRAY['engineering', 'admin'], 1)
         RETURNING id;`,
        [tenantAId],
      );
      const docAId = docARes.rows[0].id;

      // Dummy 384-dim zero vector for chunk
      const dummyVec = `[${new Array(384).fill(0.05).join(',')}]`;

      await client.query(
        `INSERT INTO chunks (doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
         VALUES ($1, $2, ARRAY['engineering'], 1, 1, 'all-MiniLM-L6-v2', 'Alpha secret engineering specs', $3::vector);`,
        [docAId, tenantAId, dummyVec],
      );

      // Seed Document & Chunk for Tenant B
      const docBRes = await client.query(
        `INSERT INTO documents (tenant_id, filename, source, allowed_roles, sensitivity)
         VALUES ($1, 'beta_doc.txt', 'upload', ARRAY['finance'], 2)
         RETURNING id;`,
        [tenantBId],
      );
      const docBId = docBRes.rows[0].id;

      await client.query(
        `INSERT INTO chunks (doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
         VALUES ($1, $2, ARRAY['finance'], 2, 1, 'all-MiniLM-L6-v2', 'Beta confidential financial ledger', $3::vector);`,
        [docBId, tenantBId, dummyVec],
      );

      // Seed an audit event for Tenant A
      await client.query(
        `INSERT INTO audit_events (seq, tenant_id, user_id, roles, clearance, query_hash, applied_filter, request_id, prev_hash, entry_hash)
         VALUES (1, $1, 'user-alpha-1', ARRAY['engineering'], 1, 'hash_test', '{}', 'req-1', $2, 'mock_entry_hash');`,
        [tenantAId, '0'.repeat(64)],
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
      await client.query('DELETE FROM audit_events WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
      await client.query('DELETE FROM tenants WHERE id IN ($1, $2);', [tenantAId, tenantBId]);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');
    } finally {
      client.release();
    }
    await migratorPool.end();
    await appPool.end();
  });

  it('proves app_user does NOT possess BYPASSRLS or SUPERUSER privileges', async () => {
    await expect(assertRuntimeRolePrivileges(appPool)).resolves.not.toThrow();
  });

  it('returns 0 chunks when app.tenant_id is not set (fail-closed by default)', async () => {
    const client = await appPool.connect();
    try {
      // Query without any session variable
      const res = await client.query('SELECT * FROM chunks;');
      expect(res.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('returns only Tenant A chunks when app.tenant_id is set to Tenant A', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

      const res = await client.query('SELECT id, tenant_id, text FROM chunks;');
      expect(res.rows.length).toBeGreaterThan(0);
      for (const row of res.rows) {
        expect(row.tenant_id).toBe(tenantAId);
        expect(row.text).toContain('Alpha');
      }

      await client.query('COMMIT;');
    } finally {
      client.release();
    }
  });

  it('strictly isolates Tenant B: Tenant A chunks are completely invisible to Tenant B', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantBId]);

      const res = await client.query('SELECT id, tenant_id, text FROM chunks;');
      expect(res.rows.length).toBeGreaterThan(0);
      for (const row of res.rows) {
        expect(row.tenant_id).toBe(tenantBId);
        expect(row.text).toContain('Beta');
        expect(row.text).not.toContain('Alpha');
      }

      await client.query('COMMIT;');
    } finally {
      client.release();
    }
  });

  it('strictly isolates documents table across tenants', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

      const resA = await client.query('SELECT filename FROM documents;');
      expect(resA.rows).toHaveLength(1);
      expect(resA.rows[0].filename).toBe('alpha_doc.txt');

      await client.query('COMMIT;');

      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantBId]);

      const resB = await client.query('SELECT filename FROM documents;');
      expect(resB.rows).toHaveLength(1);
      expect(resB.rows[0].filename).toBe('beta_doc.txt');

      await client.query('COMMIT;');
    } finally {
      client.release();
    }
  });

  it('strictly blocks UPDATE and DELETE on audit_events for app_user', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

      // Attempt UPDATE as app_user
      await expect(
        client.query(`UPDATE audit_events SET query_hash = 'tampered' WHERE tenant_id = $1;`, [
          tenantAId,
        ]),
      ).rejects.toThrow();

      await client.query('ROLLBACK;');

      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

      // Attempt DELETE as app_user
      await expect(
        client.query(`DELETE FROM audit_events WHERE tenant_id = $1;`, [tenantAId]),
      ).rejects.toThrow();

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });
});
