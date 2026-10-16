import type { EmbeddingProvider } from './types.js';
import { TransformersEmbedder } from './transformersEmbedder.js';
import { FakeEmbedder } from './fakeEmbedder.js';
import { env } from '../../config/env.js';

export * from './types.js';
export * from './transformersEmbedder.js';
export * from './fakeEmbedder.js';

let defaultEmbedderInstance: EmbeddingProvider | null = null;

export function getEmbedder(): EmbeddingProvider {
  if (defaultEmbedderInstance) {
    return defaultEmbedderInstance;
  }

  // In test environments, default to FakeEmbedder for ultra-fast execution unless explicitly configured
  if (env.NODE_ENV === 'test') {
    defaultEmbedderInstance = new FakeEmbedder();
  } else {
    defaultEmbedderInstance = new TransformersEmbedder();
  }

  return defaultEmbedderInstance;
}

export function setEmbedder(embedder: EmbeddingProvider): void {
  defaultEmbedderInstance = embedder;
}
