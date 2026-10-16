import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/jwt.js';
import { migratorPool } from '../src/db/pool.js';
import { buildMultipartPayload } from './utils/multipart.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 3: Ingestion Service & Endpoints Integration Suite', () => {
  let app: FastifyInstance;

  const tenantId = '33333333-3333-3333-3333-333333333333';
  const otherTenantId = '44444444-4444-4444-4444-444444444444';

  const editorPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'editor_user',
    roles: ['editor'],
    clearance: 2,
  };

  const adminPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'admin_user',
    roles: ['admin'],
    clearance: 3,
  };

  const viewerPrincipal: Principal = {
    tenant_id: tenantId,
    user_id: 'viewer_user',
    roles: ['viewer'],
    clearance: 1,
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed tenants
    const client = await migratorPool.connect();
    try {
      await client.query(`
        INSERT INTO tenants (id, name, config)
        VALUES 
          ('${tenantId}', 'Tenant Gamma Corp', '{"tier": "enterprise"}'),
          ('${otherTenantId}', 'Tenant Delta Inc', '{"tier": "standard"}')
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query(`DELETE FROM chunks WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');`);
      await client.query(`DELETE FROM documents WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');`);
      await client.query(`DELETE FROM tenants WHERE id IN ('${tenantId}', '${otherTenantId}');`);
    } finally {
      client.release();
    }
    await app.close();
  });

  it('rejects upload from unauthorized role (viewer) with 403 Forbidden', async () => {
    const token = await signToken(viewerPrincipal);
    const { body, headers } = buildMultipartPayload(
      {
        allowed_roles: JSON.stringify(['engineering']),
        sensitivity: '1',
      },
      {
        fieldName: 'file',
        filename: 'notes.txt',
        content: 'Some notes text',
        contentType: 'text/plain',
      }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
  });

  it('successfully ingests a Markdown document, chunks and stores 384-dim vectors', async () => {
    const token = await signToken(editorPrincipal);
    const content = `
# Project Plan

This document outlines the zero-leakage multi-tenant RAG architecture.
It ensures that unauthorized users cannot retrieve or infer confidential chunks.

## Security Architecture

Row Level Security is strictly applied to all tenant tables in PostgreSQL.
Every connection checkout enforces session configuration using set_config.
`;

    const { body, headers } = buildMultipartPayload(
      {
        allowed_roles: JSON.stringify(['engineering', 'admin']),
        sensitivity: '2',
      },
      {
        fieldName: 'file',
        filename: 'project_plan.md',
        content,
        contentType: 'text/markdown',
      }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const docData = res.json();
    expect(docData.id).toBeDefined();
    expect(docData.tenant_id).toBe(tenantId);
    expect(docData.filename).toBe('project_plan.md');
    expect(docData.status).toBe('indexed');
    expect(docData.chunk_count).toBeGreaterThan(0);
    expect(docData.acl).toEqual({
      allowed_roles: ['engineering', 'admin'],
      sensitivity: 2,
      acl_version: 1,
    });

    // Verify database state directly
    const client = await migratorPool.connect();
    try {
      const docRes = await client.query('SELECT * FROM documents WHERE id = $1', [docData.id]);
      expect(docRes.rows.length).toBe(1);
      expect(docRes.rows[0].status).toBe('indexed');

      const chunkRes = await client.query('SELECT * FROM chunks WHERE doc_id = $1', [docData.id]);
      expect(chunkRes.rows.length).toBe(docData.chunk_count);
      expect(chunkRes.rows[0].tenant_id).toBe(tenantId);
      expect(chunkRes.rows[0].embedding_model).toBeDefined();
      expect(chunkRes.rows[0].sensitivity).toBe(2);
      expect(chunkRes.rows[0].allowed_roles).toEqual(['engineering', 'admin']);
    } finally {
      client.release();
    }
  });

  it('rejects upload with missing ACL or invalid sensitivity with 400', async () => {
    const token = await signToken(editorPrincipal);

    // Missing allowed_roles
    const { body, headers } = buildMultipartPayload(
      {
        sensitivity: '1',
      },
      {
        fieldName: 'file',
        filename: 'test.txt',
        content: 'Valid content',
        contentType: 'text/plain',
      }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('allowed_roles');
  });

  it('ignores spoofed tenant_id in form fields and binds strictly to JWT tenant', async () => {
    const token = await signToken(editorPrincipal); // has tenantId = 33333333-...

    const { body, headers } = buildMultipartPayload(
      {
        tenant_id: otherTenantId, // Attempted spoofing!
        allowed_roles: JSON.stringify(['engineering']),
        sensitivity: '1',
      },
      {
        fieldName: 'file',
        filename: 'spoof_test.txt',
        content: 'Spoof test content to verify tenant isolation binding',
        contentType: 'text/plain',
      }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const data = res.json();
    // Must match token's tenant, NOT the spoofed one
    expect(data.tenant_id).toBe(tenantId);

    const client = await migratorPool.connect();
    try {
      const doc = await client.query('SELECT tenant_id FROM documents WHERE id = $1', [data.id]);
      expect(doc.rows[0].tenant_id).toBe(tenantId);
    } finally {
      client.release();
    }
  });

  it('allows admin to delete document and cascades deletion to vector chunks', async () => {
    // 1. Upload a document first
    const token = await signToken(adminPrincipal);
    const { body, headers } = buildMultipartPayload(
      {
        allowed_roles: JSON.stringify(['admin']),
        sensitivity: '0',
      },
      {
        fieldName: 'file',
        filename: 'temp_doc.txt',
        content: 'This document will be deleted.',
        contentType: 'text/plain',
      }
    );

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      payload: body,
    });

    expect(uploadRes.statusCode).toBe(201);
    const docId = uploadRes.json().id;

    // Verify chunks exist
    const client = await migratorPool.connect();
    try {
      const beforeChunks = await client.query('SELECT id FROM chunks WHERE doc_id = $1', [docId]);
      expect(beforeChunks.rows.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }

    // 2. Delete the document
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/documents/${docId}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().deleted).toBe(true);

    // 3. Verify cascading delete in database
    const verifyClient = await migratorPool.connect();
    try {
      const docCheck = await verifyClient.query('SELECT id FROM documents WHERE id = $1', [docId]);
      expect(docCheck.rows.length).toBe(0);

      const chunkCheck = await verifyClient.query('SELECT id FROM chunks WHERE doc_id = $1', [docId]);
      expect(chunkCheck.rows.length).toBe(0);
    } finally {
      verifyClient.release();
    }
  });
});
