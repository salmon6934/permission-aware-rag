import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { appPool } from './db/pool.js';
import { devRoutes } from './routes/dev.js';
import { documentRoutes } from './routes/documents.js';
import { MAX_FILE_SIZE_BYTES } from './ingestion/constants.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
  });

  app.register(cors, {
    origin: true,
  });

  // Register multipart streaming for file uploads with 10MB limit
  app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: 1,
    },
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

  // Register dev routes (test token generation)
  app.register(devRoutes);

  // Register document routes (upload and deletion)
  app.register(documentRoutes);

  return app;
}
