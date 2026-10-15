import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './jwt.js';
import type { Principal } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/**
 * Fastify preHandler hook that enforces Bearer token authentication.
 * Rejects missing, expired, or invalid tokens with HTTP 401 (fail-closed).
 * On success, attaches verified `request.principal`.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected Bearer token.',
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Empty Bearer token provided.',
    });
    return;
  }

  try {
    const principal = await verifyToken(token);
    request.principal = principal;
  } catch (err) {
    request.log.warn({ err }, 'Authentication failed');
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid, expired, or untrusted authentication token.',
    });
  }
}
