import type { FastifyInstance } from 'fastify';
import { metrics } from '../services/metrics.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    return reply.status(200).send(metrics.getSnapshot());
  });
}
