import * as jose from 'jose';
import { env } from '../config/env.js';
import { PrincipalSchema, type Principal } from './types.js';

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export interface SignTokenOptions {
  expiresIn?: string; // e.g. '1h', '24h', '7d'
}

/**
 * Signs a JWT with the given Principal claims using HMAC-SHA256.
 */
export async function signToken(
  principal: Principal,
  options: SignTokenOptions = {}
): Promise<string> {
  const validatedPrincipal = PrincipalSchema.parse(principal);
  const expiresIn = options.expiresIn ?? '1h';

  return await new jose.SignJWT({ ...validatedPrincipal })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

/**
 * Verifies and parses a JWT, enforcing HS256 algorithm and strict schema validation.
 * Throws an Error if token is invalid, expired, or claims are malformed.
 */
export async function verifyToken(token: string): Promise<Principal> {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing or invalid token string');
  }

  const { payload } = await jose.jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  });

  // Strict validation of the decoded payload claims
  return PrincipalSchema.parse(payload);
}
