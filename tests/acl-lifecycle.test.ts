import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/jwt.js';
import { migratorPool } from '../src/db/pool.js';
import { retrieveChunks } from '../src/services/retrieval.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { buildMultipartPayload } from './utils/multipart.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 4: Dynamic ACL Update & Lifecycle Tests', () => {
  let app: FastifyInstance;

  const tenantId = '77777777-7777-7777-7777-777777777777';
  const embedder = new FakeEmbedder();

  const adminPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'admin_usr',
    roles: ['admin'],
    clearance: 3,
  };

  const engineeringPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'eng_usr',
    roles: ['engineering'],
    clearance: 2,
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await migratorPool.connect();
    try {
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES ('${tenantId}', 'ACL Lifecycle Tenant', '{}')
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
      await client.query(`DELETE FROM chunks WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM documents WHERE tenant_id = '${tenantId}';`);
      await client.query(`DELETE FROM tenants WHERE id = '${tenantId}';`);
      await client.query('COMMIT;');
    } finally {
      client.release();
    }
    await app.close();
  });

  it('proves instant ACL update without re-embedding', async () => {
    const adminToken = await signToken(adminPrincipal);

    // 1. Ingest document restricted strictly to 'finance'
    const { body, headers } = buildMultipartPayload(
      {
        allowed_roles: JSON.stringify(['finance']),
        sensitivity: '2',
      },
      {
        fieldName: 'file',
        filename: 'restricted_financials.txt',
        content: 'Confidential corporate financial audit and balance sheet report.',
        contentType: 'text/plain',
      }
    );

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${adminToken}`,
      },
      payload: body,
    });

    expect(uploadRes.statusCode).toBe(201);
    const docId = uploadRes.json().id;
    expect(uploadRes.json().acl.acl_version).toBe(1);

    // 2. Query as engineering user -> returns 0 chunks because role is 'engineering', not 'finance'
    const initialQuery = await retrieveChunks({
      query: 'corporate financial audit balance sheet',
      principal: engineeringPrincipal,
      embedder,
    });
    expect(initialQuery.length).toBe(0);

    // 3. Admin patches ACL to grant access to 'engineering'
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/documents/${docId}/acl`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        allowed_roles: ['finance', 'engineering'],
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const updatedDoc = patchRes.json().document;
    expect(updatedDoc.acl_version).toBe(2);
    expect(updatedDoc.allowed_roles).toEqual(['finance', 'engineering']);

    // 4. Engineering user immediately re-queries -> chunks are now retrieved instantly!
    const subsequentQuery = await retrieveChunks({
      query: 'corporate financial audit balance sheet',
      principal: engineeringPrincipal,
      embedder,
    });

    expect(subsequentQuery.length).toBeGreaterThan(0);
    expect(subsequentQuery[0].doc_id).toBe(docId);
    expect(subsequentQuery[0].acl_version).toBe(2);
    expect(subsequentQuery[0].allowed_roles).toContain('engineering');

    // 5. Verify database integrity: chunks table has updated acl_version and allowed_roles
    const client = await migratorPool.connect();
    try {
      const chunkRows = await client.query('SELECT acl_version, allowed_roles FROM chunks WHERE doc_id = $1', [docId]);
      for (const row of chunkRows.rows) {
        expect(row.acl_version).toBe(2);
        expect(row.allowed_roles).toEqual(['finance', 'engineering']);
      }
    } finally {
      client.release();
    }
  });
});
