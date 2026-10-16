import { env } from '../../config/env.js';
import type { LLMProvider, GenerationOptions, LLMResponse } from './types.js';

export class HostedLLM implements LLMProvider {
  public readonly name: string;
  private readonly apiKey: string;
  private readonly provider: string;

  constructor(provider = env.LLM_PROVIDER, apiKey = env.LLM_API_KEY) {
    this.provider = provider.toLowerCase();
    this.apiKey = apiKey;
    this.name = `hosted-${this.provider}`;
  }

  public async generateAnswer(
    prompt: string,
    options: GenerationOptions = {}
  ): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error(`Missing LLM_API_KEY for provider '${this.provider}'. Configure LLM_API_KEY in .env`);
    }

    return await this.executeWithRetry(async () => {
      if (this.provider === 'groq') {
        return await this.callGroq(prompt, options);
      }
      // Default to Google Gemini (gemini-1.5-flash)
      return await this.callGemini(prompt, options);
    });
  }

  private async callGemini(prompt: string, options: GenerationOptions): Promise<LLMResponse> {
    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxTokens ?? 1024,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Gemini API error (HTTP ${res.status}): ${errText}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return {
      answer,
      model: `gemini/${model}`,
    };
  }

  private async callGroq(prompt: string, options: GenerationOptions): Promise<LLMResponse> {
    const model = 'llama-3.1-8b-instant';
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1024,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Groq API error (HTTP ${res.status}): ${errText}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const answer = data.choices?.[0]?.message?.content?.trim() || '';
    return {
      answer,
      model: `groq/${model}`,
    };
  }

  /**
   * Exponential backoff retry handler with jitter for rate limits (429) and timeouts.
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    initialDelayMs = 200
  ): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await operation();
      } catch (err) {
        attempt++;
        const status = (err as Error & { status?: number }).status;
        const isRetryable =
          status === 429 ||
          status === 503 ||
          status === 504 ||
          (err instanceof Error &&
            (err.message.includes('fetch failed') ||
              err.message.includes('ETIMEDOUT') ||
              err.message.includes('rate limit')));

        if (!isRetryable || attempt > maxRetries) {
          throw err;
        }

        // Jittered exponential delay
        const backoff = initialDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 50;
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      }
    }
    throw new Error('LLM operation failed after maximum retries');
  }
}
