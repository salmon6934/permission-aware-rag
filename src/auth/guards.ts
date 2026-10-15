import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Creates a route preHandler guard that ensures the authenticated principal
 * has at least one of the specified allowed roles.
 */
export function requireRole(allowedRoles: string[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.principal) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required prior to authorization check.',
      });
      return;
    }

    const userRoles = request.principal.roles;
    const hasRole = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Insufficient permissions. Required one of: [${allowedRoles.join(', ')}]`,
      });
      return;
    }
  };
}

/**
 * Creates a route preHandler guard that ensures the authenticated principal
 * meets the minimum required sensitivity clearance level (0 to 3).
 */
export function requireClearance(minClearance: number) {
  return async function clearanceGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.principal) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required prior to authorization check.',
      });
      return;
    }

    if (request.principal.clearance < minClearance) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Insufficient clearance level. Required minimum: ${minClearance}, possessed: ${request.principal.clearance}`,
      });
      return;
    }
  };
}
