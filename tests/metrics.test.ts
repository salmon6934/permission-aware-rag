import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { metrics } from '../src/services/metrics.js';

describe('Observability & Metrics Endpoint Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    metrics.reset();
  });

  it('GET /metrics returns initial operational snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.total_requests).toBe(0);
    expect(body.total_queries).toBe(0);
    expect(body.successful_generations).toBe(0);
    expect(body.denied_or_empty_queries).toBe(0);
    expect(body.llm_retry_count).toBe(0);
    expect(body.avg_query_latency_ms).toBe(0);
    expect(body.timestamp).toBeDefined();
  });

  it('records metrics accurately when queries are processed', async () => {
    metrics.recordRequest();
    metrics.recordQuery(120, false, true);
    metrics.recordQuery(80, true, false);
    metrics.recordLlmRetry();

    const snapshot = metrics.getSnapshot();
    expect(snapshot.total_requests).toBe(1);
    expect(snapshot.total_queries).toBe(2);
    expect(snapshot.successful_generations).toBe(1);
    expect(snapshot.denied_or_empty_queries).toBe(1);
    expect(snapshot.llm_retry_count).toBe(1);
    expect(snapshot.avg_query_latency_ms).toBe(100);
  });
});
