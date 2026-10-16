import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { signToken, verifyToken } from '../src/auth/jwt.js';
import type { Principal } from '../src/auth/types.js';

describe('Day 2: JWT Service Unit Tests', () => {
  const validPrincipal: Principal = {
    tenant_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    user_id: 'user_engineering_1',
    roles: ['engineering', 'member'],
    clearance: 2,
  };

  it('signs and verifies a valid token successfully', async () => {
    const token = await signToken(validPrincipal);
    expect(typeof token).toBe('string');

    const claims = await verifyToken(token);
    expect(claims).toEqual(validPrincipal);
  });

  it('fails closed when token is expired', async () => {
    // Generate token that expired 1 second ago
    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-dev-jwt-key-must-be-at-least-32-chars-long');
    const expiredToken = await new jose.SignJWT({ ...validPrincipal })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 100)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secretKey);

    await expect(verifyToken(expiredToken)).rejects.toThrow();
  });

  it('fails closed when token signature is tampered with', async () => {
    const token = await signToken(validPrincipal);
    const parts = token.split('.');
    // Alter first character of the signature to guarantee byte modification
    const signature = parts[2];
    const tamperedSig = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
    const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

    await expect(verifyToken(tamperedToken)).rejects.toThrow();
  });

  it('fails closed when signed with a different secret', async () => {
    const wrongSecret = new TextEncoder().encode('different-secret-key-32-chars-long-abc');
    const invalidToken = await new jose.SignJWT({ ...validPrincipal })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongSecret);

    await expect(verifyToken(invalidToken)).rejects.toThrow();
  });

  it('fails closed when claims are missing tenant_id or user_id', async () => {
    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-dev-jwt-key-must-be-at-least-32-chars-long');
    const missingClaimsToken = await new jose.SignJWT({
      user_id: 'user_1',
      roles: ['admin'],
      clearance: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    await expect(verifyToken(missingClaimsToken)).rejects.toThrow();
  });

  it('fails closed when tenant_id is not a valid UUID', async () => {
    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-dev-jwt-key-must-be-at-least-32-chars-long');
    const malformedTenantToken = await new jose.SignJWT({
      tenant_id: 'invalid-not-a-uuid',
      user_id: 'user_1',
      roles: ['admin'],
      clearance: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    await expect(verifyToken(malformedTenantToken)).rejects.toThrow();
  });

  it('fails closed when clearance is invalid (< 0 or > 3)', async () => {
    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-dev-jwt-key-must-be-at-least-32-chars-long');
    
    // clearance = 5
    const highClearanceToken = await new jose.SignJWT({
      ...validPrincipal,
      clearance: 5,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    await expect(verifyToken(highClearanceToken)).rejects.toThrow();

    // clearance = -1
    const negClearanceToken = await new jose.SignJWT({
      ...validPrincipal,
      clearance: -1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    await expect(verifyToken(negClearanceToken)).rejects.toThrow();
  });

  it('fails closed on empty string or null token', async () => {
    await expect(verifyToken('')).rejects.toThrow();
    // @ts-expect-error testing runtime validation on non-string input
    await expect(verifyToken(null)).rejects.toThrow();
  });
});
