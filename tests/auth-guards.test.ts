import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authenticate } from '../src/auth/authHook.js';
import { requireRole, requireClearance } from '../src/auth/guards.js';
import { signToken } from '../src/auth/jwt.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 2: Authentication Hook & Role/Clearance Guards', () => {
  let app: FastifyInstance;

  const adminPrincipal: Principal = {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    user_id: 'admin_user',
    roles: ['admin'],
    clearance: 3,
  };

  const engineeringPrincipal: Principal = {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    user_id: 'eng_user',
    roles: ['engineering'],
    clearance: 1,
  };

  beforeAll(async () => {
    app = Fastify();

    // Route requiring authentication only
    app.get(
      '/protected',
      { preHandler: [authenticate] },
      async (req) => ({ principal: req.principal })
    );

    // Route requiring role 'admin'
    app.get(
      '/admin-only',
      { preHandler: [authenticate, requireRole(['admin'])] },
      async (req) => ({ message: 'admin access granted', user: req.principal?.user_id })
    );

    // Route requiring role 'admin' or 'editor'
    app.get(
      '/editor-or-admin',
      { preHandler: [authenticate, requireRole(['editor', 'admin'])] },
      async () => ({ message: 'editor/admin access granted' })
    );

    // Route requiring clearance >= 2
    app.get(
      '/clearance-2',
      { preHandler: [authenticate, requireClearance(2)] },
      async () => ({ message: 'clearance 2 granted' })
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
  });

  it('rejects malformed Authorization header with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: 'Basic abc12345',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid or tampered token with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: 'Bearer bad.token.here',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows authenticated request to protected route', async () => {
    const token = await signToken(engineeringPrincipal);
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().principal).toEqual(engineeringPrincipal);
  });

  it('rejects user with insufficient role with 403 Forbidden', async () => {
    const token = await signToken(engineeringPrincipal);
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Forbidden');
    expect(res.json().message).toContain('Insufficient permissions');
  });

  it('grants access to user with matching role', async () => {
    const token = await signToken(adminPrincipal);
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('admin access granted');
  });

  it('grants access to multi-role guard when user has one matching role', async () => {
    const token = await signToken(adminPrincipal);
    const res = await app.inject({
      method: 'GET',
      url: '/editor-or-admin',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('enforces clearance levels: rejects clearance 1 when clearance >= 2 is required', async () => {
    const token = await signToken(engineeringPrincipal); // clearance 1
    const res = await app.inject({
      method: 'GET',
      url: '/clearance-2',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Insufficient clearance level');
  });

  it('enforces clearance levels: grants access when clearance >= 2 is met', async () => {
    const token = await signToken(adminPrincipal); // clearance 3
    const res = await app.inject({
      method: 'GET',
      url: '/clearance-2',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
