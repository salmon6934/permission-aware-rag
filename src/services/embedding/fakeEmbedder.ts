import type { EmbeddingProvider } from './types.js';

/**
 * Deterministic fake embedder for ultra-fast, offline unit & integration testing.
 * Produces unit-normalized 384-dimensional vectors based on simple deterministic hashing.
 */
export class FakeEmbedder implements EmbeddingProvider {
  public readonly dimensions: number = 384;
  public readonly modelName: string = 'fake-minilm-l6-v2';

  public async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateVector(text));
  }

  private generateVector(text: string): number[] {
    const vec: number[] = new Array(this.dimensions);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }

    let sumSq = 0;
    for (let i = 0; i < this.dimensions; i++) {
      const val = Math.sin(hash + i);
      vec[i] = val;
      sumSq += val * val;
    }

    // Normalize to unit length (for cosine similarity)
    const norm = Math.sqrt(sumSq) || 1;
    return vec.map((v) => Number((v / norm).toFixed(6)));
  }
}
