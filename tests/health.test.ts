import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { appPool, migratorPool } from '../src/db/pool.js';

describe('Fastify Healthcheck API', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await migratorPool.end();
  });

  it('GET /health returns 200 with status ok and db connected', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toEqual({
      status: 'ok',
      db: 'connected',
    });
  });
});
