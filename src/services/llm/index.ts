import type { LLMProvider } from './types.js';
import { FakeLLM } from './fakeLlm.js';
import { HostedLLM } from './hostedLlm.js';
import { env } from '../../config/env.js';

export * from './types.js';
export * from './fakeLlm.js';
export * from './hostedLlm.js';

let defaultLlmInstance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (defaultLlmInstance) {
    return defaultLlmInstance;
  }

  // Default to FakeLLM in test mode or when no valid LLM_API_KEY is supplied
  const isPlaceholder =
    !env.LLM_API_KEY ||
    env.LLM_API_KEY.includes('your-') ||
    env.LLM_API_KEY.includes('placeholder');

  if (env.NODE_ENV === 'test' || isPlaceholder) {
    defaultLlmInstance = new FakeLLM();
  } else {
    defaultLlmInstance = new HostedLLM();
  }

  return defaultLlmInstance;
}

export function setLLMProvider(provider: LLMProvider): void {
  defaultLlmInstance = provider;
}
