import type { LLMProvider, GenerationOptions, LLMResponse } from './types.js';

export class FakeLLM implements LLMProvider {
  public readonly name = 'fake-llm';
  private failAttemptsRemaining = 0;
  private failStatusCode = 429;
  public totalCalls = 0;

  /**
   * Configures the mock LLM to simulate transient errors (e.g. HTTP 429 rate limit)
   * for a specified number of attempts before succeeding.
   */
  public simulateTransientFailures(attempts: number, statusCode: number = 429): void {
    this.failAttemptsRemaining = attempts;
    this.failStatusCode = statusCode;
  }

  public async generateAnswer(
    prompt: string,
    _options?: GenerationOptions
  ): Promise<LLMResponse> {
    this.totalCalls++;

    if (this.failAttemptsRemaining > 0) {
      this.failAttemptsRemaining--;
      const error = new Error(`Simulated LLM rate limit or timeout error (status ${this.failStatusCode})`);
      (error as Error & { status?: number }).status = this.failStatusCode;
      throw error;
    }

    // Extract any chunk/doc citation IDs from prompt for realistic grounded responses
    const chunkMatches = prompt.match(/chunk_id:\s*([a-f0-9-]+)/gi) || [];
    const docMatches = prompt.match(/doc_id:\s*([a-f0-9-]+)/gi) || [];

    const citations: string[] = [];
    for (const m of docMatches) {
      const id = m.split(':')[1]?.trim();
      if (id && !citations.includes(`doc:${id}`)) citations.push(`doc:${id}`);
    }
    for (const m of chunkMatches) {
      const id = m.split(':')[1]?.trim();
      if (id && !citations.includes(`chunk:${id}`)) citations.push(`chunk:${id}`);
    }

    return {
      answer: `Based on authorized documentation: The requested information is confirmed within the authorized tenant context. Citations: ${citations.join(', ') || 'none'}.`,
      model: this.name,
      citations,
    };
  }
}
