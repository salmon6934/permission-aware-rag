import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { signToken } from '../auth/jwt.js';
import { PrincipalSchema } from '../auth/types.js';

const DevTokenBodySchema = PrincipalSchema.extend({
  expiresIn: z.string().optional(),
});

export async function devRoutes(app: FastifyInstance): Promise<void> {
  // Available in non-production, and for demo dashboard token signing
  app.post('/dev/token', async (request, reply) => {
    try {
      const parsed = DevTokenBodySchema.parse(request.body);
      const { expiresIn, ...principal } = parsed;

      const token = await signToken(principal, { expiresIn });

      return reply.status(200).send({
        token,
        principal,
        expiresIn: expiresIn ?? '1h',
      });
    } catch (err) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: err instanceof Error ? err.message : 'Invalid request body',
      });
    }
  });
}
