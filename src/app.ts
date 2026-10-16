import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { appPool } from './db/pool.js';
import { devRoutes } from './routes/dev.js';
import { documentRoutes } from './routes/documents.js';
import { queryRoutes } from './routes/query.js';
import { auditRoutes } from './routes/audit.js';
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

  // Register document routes (upload, deletion, and ACL updates)
  app.register(documentRoutes);

  // Register query route (RAG answer generation with citations)
  app.register(queryRoutes);

  // Register audit routes (hash chain inspection and cryptographic verification)
  app.register(auditRoutes);

  // Centralized Error Sanitization Handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const err = error as { statusCode?: number; name?: string; message?: string };
    const statusCode =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    if (statusCode >= 500) {
      return reply.status(statusCode).send({
        statusCode,
        error: 'Internal Server Error',
        message: 'An unexpected internal error occurred. Please contact system support.',
      });
    }

    return reply.status(statusCode).send({
      statusCode,
      error: err.name || 'Bad Request',
      message: err.message || 'The request could not be processed.',
    });
  });

  // Centralized Not-Found Handler
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested resource was not found.',
    });
  });

  return app;
}
