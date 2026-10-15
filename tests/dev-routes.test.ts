import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { verifyToken } from '../src/auth/jwt.js';

describe('Day 2: Dev Token Endpoint Tests', () => {
  it('issues valid signed JWT on POST /dev/token', async () => {
    const app = buildApp();
    await app.ready();

    const payload = {
      tenant_id: '22222222-2222-2222-2222-222222222222',
      user_id: 'alice',
      roles: ['finance'],
      clearance: 2,
      expiresIn: '2h',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/dev/token',
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();

    // Verify token with our jwt verifier
    const claims = await verifyToken(body.token);
    expect(claims.tenant_id).toBe(payload.tenant_id);
    expect(claims.user_id).toBe(payload.user_id);
    expect(claims.roles).toEqual(['finance']);
    expect(claims.clearance).toBe(2);

    await app.close();
  });

  it('rejects POST /dev/token with invalid payload (missing fields)', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/dev/token',
      payload: {
        user_id: 'bob',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Bad Request');

    await app.close();
  });
});
