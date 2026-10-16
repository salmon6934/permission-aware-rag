export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMResponse {
  answer: string;
  model: string;
  citations?: string[];
}

export interface LLMProvider {
  readonly name: string;
  generateAnswer(prompt: string, options?: GenerationOptions): Promise<LLMResponse>;
}
