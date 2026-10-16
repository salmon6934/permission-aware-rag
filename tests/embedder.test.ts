import { describe, it, expect } from 'vitest';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { TransformersEmbedder } from '../src/services/embedding/transformersEmbedder.js';

describe('Day 3: Embedder Test Suite', () => {
  describe('FakeEmbedder', () => {
    const embedder = new FakeEmbedder();

    it('generates 384-dimensional vectors', async () => {
      const res = await embedder.embed(['Hello world']);
      expect(res.length).toBe(1);
      expect(res[0].length).toBe(384);
    });

    it('produces unit-normalized vectors (magnitude ~ 1.0)', async () => {
      const res = await embedder.embed(['Test normalized vector']);
      const vec = res[0];
      const magnitudeSq = vec.reduce((sum, val) => sum + val * val, 0);
      expect(Math.abs(Math.sqrt(magnitudeSq) - 1.0)).toBeLessThan(1e-4);
    });

    it('is completely deterministic for identical inputs', async () => {
      const res1 = await embedder.embed(['Deterministic sentence']);
      const res2 = await embedder.embed(['Deterministic sentence']);
      expect(res1[0]).toEqual(res2[0]);
    });
  });

  describe('TransformersEmbedder (in-process model)', () => {
    const embedder = new TransformersEmbedder();

    it('produces 384-dimensional normalized embeddings using Xenova/all-MiniLM-L6-v2', async () => {
      const res = await embedder.embed(['Multi-tenant permission aware RAG architecture.']);
      expect(res.length).toBe(1);
      expect(res[0].length).toBe(384);

      // Verify unit length for cosine similarity
      const vec = res[0];
      const magnitudeSq = vec.reduce((sum, val) => sum + val * val, 0);
      expect(Math.abs(Math.sqrt(magnitudeSq) - 1.0)).toBeLessThan(1e-2);
    }, 30000); // 30s timeout for model load if cold
  });
});
