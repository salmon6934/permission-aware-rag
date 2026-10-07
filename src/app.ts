import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { appPool } from './db/pool.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
  });

  app.register(cors, {
    origin: true,
  });

  // Health check endpoint
  app.get('/health', async (request, reply) => {
    try {
      // Check database connectivity via app_user pool
      await appPool.query('SELECT 1;');
      return reply.status(200).send({
        status: 'ok',
        db: 'connected',
      });
    } catch (err) {
      request.log.error(err, 'Database connection healthcheck failed');
      return reply.status(503).send({
        status: 'error',
        db: 'disconnected',
      });
    }
  });

  return app;
}
