import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { migratorPool } from '../src/db/pool.js';
import { recordAuditEvent } from '../src/services/auditLogger.js';
import { signToken } from '../src/auth/jwt.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 6: Audit Tamper Detection Integration Suite', () => {
  const app = buildApp();
  const tenantId = '77777777-6666-5555-4444-777777777777';

  const adminPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'tamper_test_admin',
    roles: ['admin'],
    clearance: 3,
  };

  beforeAll(async () => {
    await app.ready();

    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SET LOCAL app.allow_test_mutation = 'true';");
      await client.query(`DELETE FROM audit_events WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
      await client.query('COMMIT;');

      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'Audit Tamper Tenant', '{}')
        ON CONFLICT (id) DO NOTHING;
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
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
      await client.query('COMMIT;');
    } finally {
      client.release();
    }
    await app.close();
  });

  it('detects direct database payload tampering on sequence 2 via GET /audit/verify', async () => {
    const token = await signToken(adminPrincipal);

    // 1. Seed 3 genuine audit events
    await recordAuditEvent({
      tenantId,
      principal: adminPrincipal,
      query: 'Query event 1: initial setup',
      requestId: 'req-tamper-01',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000001'],
      aclVersions: [1],
      generationOccurred: true,
    });

    await recordAuditEvent({
      tenantId,
      principal: adminPrincipal,
      query: 'Query event 2: sensitive confidential audit target',
      requestId: 'req-tamper-02',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000002'],
      aclVersions: [1],
      generationOccurred: true,
    });

    await recordAuditEvent({
      tenantId,
      principal: adminPrincipal,
      query: 'Query event 3: concluding log event',
      requestId: 'req-tamper-03',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000003'],
      aclVersions: [1],
      generationOccurred: true,
    });

    // 2. Verify audit chain is initially valid
    const preRes = await app.inject({
      method: 'GET',
      url: '/audit/verify',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preRes.statusCode).toBe(200);
    expect(preRes.json().valid).toBe(true);
    expect(preRes.json().total_events).toBe(3);

    // 3. Simulate a privileged attacker altering an audit row directly in PostgreSQL
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SET LOCAL app.allow_test_mutation = 'true';");
      await client.query(`
        UPDATE audit_events
        SET query_hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        WHERE tenant_id = '${tenantId}' AND seq = 2;
      `);
      await client.query('COMMIT;');
    } finally {
      client.release();
    }

    // 4. Run GET /audit/verify and assert tampering is detected at seq 2
    const postRes = await app.inject({
      method: 'GET',
      url: '/audit/verify',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(postRes.statusCode).toBe(409);
    const body = postRes.json();
    expect(body.valid).toBe(false);
    expect(body.message).toContain('tampering detected');
    expect(body.details.brokenSeq).toBe(2);
    expect(body.details.expectedHash).toBeDefined();
    expect(body.details.actualHash).toBeDefined();
  });

  it('detects prev_hash pointer manipulation on sequence 3', async () => {
    const token = await signToken(adminPrincipal);

    // Tamper with sequence 3's prev_hash link
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SET LOCAL app.allow_test_mutation = 'true';");
      await client.query(`
        UPDATE audit_events
        SET prev_hash = '0000000000000000000000000000000000000000000000000000000000000000'
        WHERE tenant_id = '${tenantId}' AND seq = 3;
      `);
      await client.query('COMMIT;');
    } finally {
      client.release();
    }

    // GET /audit/verify should return 409 Conflict with valid: false
    const res = await app.inject({
      method: 'GET',
      url: '/audit/verify',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().valid).toBe(false);
  });
});
