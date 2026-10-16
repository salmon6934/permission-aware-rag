import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/jwt.js';
import { migratorPool, appPool } from '../src/db/pool.js';
import { recordAuditEvent, verifyAuditChain, GENESIS_HASH } from '../src/services/auditLogger.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 5: Tamper-Evident Hash Chain Audit Log Tests', () => {
  let app: FastifyInstance;

  const tenantId = 'bbbbbbbb-9999-9999-9999-bbbbbbbbbbbb';

  const adminPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'sec_admin',
    roles: ['admin'],
    clearance: 3,
  };

  const memberPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'regular_user',
    roles: ['member'],
    clearance: 1,
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await migratorPool.connect();
    try {
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'Audit Chain Tenant', '{}')
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

  it('builds a cryptographically chained sequence starting from genesis', async () => {
    // 1. Record 3 audit events
    const event1 = await recordAuditEvent({
      tenantId,
      principal: memberPrincipal,
      query: 'first query',
      requestId: 'req-1',
      returnedChunkIds: ['11111111-1111-1111-1111-111111111111'],
      aclVersions: [1],
      generationOccurred: true,
    });

    const event2 = await recordAuditEvent({
      tenantId,
      principal: memberPrincipal,
      query: 'second query',
      requestId: 'req-2',
      returnedChunkIds: ['22222222-2222-2222-2222-222222222222'],
      aclVersions: [1],
      generationOccurred: true,
    });

    const event3 = await recordAuditEvent({
      tenantId,
      principal: memberPrincipal,
      query: 'third query',
      requestId: 'req-3',
      returnedChunkIds: [],
      aclVersions: [],
      generationOccurred: false,
    });

    // Verify sequences
    expect(Number(event1.seq)).toBe(1);
    expect(Number(event2.seq)).toBe(2);
    expect(Number(event3.seq)).toBe(3);

    // Verify genesis and hash links
    expect(event1.prev_hash).toBe(GENESIS_HASH);
    expect(event2.prev_hash).toBe(event1.entry_hash);
    expect(event3.prev_hash).toBe(event2.entry_hash);

    // Verify complete chain using verification function
    const verification = await verifyAuditChain(tenantId);
    expect(verification.valid).toBe(true);
    expect(verification.totalEvents).toBe(3);
  });

  it('allows admin to verify audit chain via GET /audit/verify', async () => {
    const token = await signToken(adminPrincipal);

    const res = await app.inject({
      method: 'GET',
      url: '/audit/verify',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.total_events).toBeGreaterThanOrEqual(3);
  });

  it('rejects GET /audit from non-admin role with 403 Forbidden', async () => {
    const token = await signToken(memberPrincipal);

    const res = await app.inject({
      method: 'GET',
      url: '/audit',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows admin to fetch paginated audit events via GET /audit', async () => {
    const token = await signToken(adminPrincipal);

    const res = await app.inject({
      method: 'GET',
      url: '/audit?limit=2&offset=0',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.events.length).toBe(2);
    expect(body.events[0].seq).toBeDefined();
    expect(body.events[0].entry_hash).toBeDefined();
  });

  it('enforces database trigger and role restrictions: blocks any SQL UPDATE or DELETE on audit_events', async () => {
    // 1. Runtime user (app_user) is blocked at role permission level
    const appClient = await appPool.connect();
    try {
      await expect(
        appClient.query(`UPDATE audit_events SET query_hash = 'tampered' WHERE tenant_id = '${tenantId}'`)
      ).rejects.toThrow(/permission denied/);

      await expect(
        appClient.query(`DELETE FROM audit_events WHERE tenant_id = '${tenantId}'`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      appClient.release();
    }

    // 2. Schema owner / admin (migrator) is blocked by database trigger
    const adminClient = await migratorPool.connect();
    try {
      await expect(
        adminClient.query(`UPDATE audit_events SET query_hash = 'tampered' WHERE tenant_id = '${tenantId}'`)
      ).rejects.toThrow(/audit_events table is append-only/);

      await expect(
        adminClient.query(`DELETE FROM audit_events WHERE tenant_id = '${tenantId}'`)
      ).rejects.toThrow(/audit_events table is append-only/);
    } finally {
      adminClient.release();
    }
  });
});
