import type { LLMProvider, GenerationOptions, LLMResponse } from './types.js';
import { FALLBACK_DENIAL_ANSWER } from '../promptBuilder.js';

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

    // Extract user question from prompt
    const questionMatch = prompt.match(/USER QUESTION:\s*(.*)/i);
    const question = questionMatch ? questionMatch[1].trim() : '';

    // Extract context section
    const contextMatch = prompt.match(/=== BEGIN AUTHORIZED CONTEXT ===([\s\S]*?)=== END AUTHORIZED CONTEXT ===/i);
    const contextText = contextMatch ? contextMatch[1] : prompt;

    // Filter query into meaningful keywords (length >= 4, lowercase, non-stop words)
    const stopWords = new Set([
      'what', 'when', 'where', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'from', 'with', 'about', 'tell', 'show', 'give', 'have', 'been', 'were', 'will',
      'would', 'could', 'should', 'reveal', 'find', 'does', 'more', 'some', 'than',
      'secret', 'confidential', 'internal', 'document', 'information', 'details', 'following',
      'alpha', 'beta', 'corp', 'portal',
    ]);
    const queryTokens = question
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));

    // Split context into chunks
    const chunkBlocks = contextText
      .split(/--- \[AUTHORIZED CONTEXT CHUNK \d+\] ---/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    const relevantDocIds = new Set<string>();
    const relevantChunkIds = new Set<string>();

    for (const block of chunkBlocks) {
      const docIdMatch = block.match(/doc_id:\s*([a-f0-9-]+)/i);
      const chunkIdMatch = block.match(/chunk_id:\s*([a-f0-9-]+)/i);
      const contentMatch = block.match(/content:\s*([\s\S]*?)---/i);

      const content = (contentMatch ? contentMatch[1] : block).toLowerCase();
      const docId = docIdMatch ? docIdMatch[1] : null;
      const chunkId = chunkIdMatch ? chunkIdMatch[1] : null;

      // Check if this chunk contains any of the query keywords
      const isRelevant = queryTokens.length === 0 || queryTokens.some((tok) => content.includes(tok));
      if (isRelevant) {
        if (docId) relevantDocIds.add(docId);
        if (chunkId) relevantChunkIds.add(chunkId);
      }
    }

    // If query tokens were present and no chunks matched, adhere to prompt instruction 2:
    if (queryTokens.length > 0 && relevantDocIds.size === 0) {
      return {
        answer: FALLBACK_DENIAL_ANSWER,
        model: this.name,
        citations: [],
      };
    }

    const citations: string[] = [
      ...Array.from(relevantDocIds).map((id) => `doc:${id}`),
      ...Array.from(relevantChunkIds).map((id) => `chunk:${id}`),
    ];

    return {
      answer: `Based on authorized documentation: The requested information is confirmed within the authorized tenant context. Citations: ${citations.join(', ') || 'none'}.`,
      model: this.name,
      citations,
    };
  }
}
