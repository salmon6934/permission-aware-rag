export interface MetricsSnapshot {
  uptime_seconds: number;
  total_requests: number;
  total_queries: number;
  successful_generations: number;
  denied_or_empty_queries: number;
  llm_retry_count: number;
  avg_query_latency_ms: number;
  timestamp: string;
}

class MetricsService {
  private startTime = Date.now();
  private totalRequests = 0;
  private totalQueries = 0;
  private successfulGenerations = 0;
  private deniedOrEmptyQueries = 0;
  private llmRetryCount = 0;
  private totalQueryLatencyMs = 0;

  public recordRequest(): void {
    this.totalRequests++;
  }

  public recordQuery(durationMs: number, wasDenied: boolean, hadGeneration: boolean): void {
    this.totalQueries++;
    this.totalQueryLatencyMs += durationMs;
    if (wasDenied) {
      this.deniedOrEmptyQueries++;
    }
    if (hadGeneration) {
      this.successfulGenerations++;
    }
  }

  public recordLlmRetry(): void {
    this.llmRetryCount++;
  }

  public getSnapshot(): MetricsSnapshot {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const avgLatency =
      this.totalQueries > 0
        ? Math.round((this.totalQueryLatencyMs / this.totalQueries) * 100) / 100
        : 0;

    return {
      uptime_seconds: uptimeSeconds,
      total_requests: this.totalRequests,
      total_queries: this.totalQueries,
      successful_generations: this.successfulGenerations,
      denied_or_empty_queries: this.deniedOrEmptyQueries,
      llm_retry_count: this.llmRetryCount,
      avg_query_latency_ms: avgLatency,
      timestamp: new Date().toISOString(),
    };
  }

  public reset(): void {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.totalQueries = 0;
    this.successfulGenerations = 0;
    this.deniedOrEmptyQueries = 0;
    this.llmRetryCount = 0;
    this.totalQueryLatencyMs = 0;
  }
}

export const metrics = new MetricsService();
