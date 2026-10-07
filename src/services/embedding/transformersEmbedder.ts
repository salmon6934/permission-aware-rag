import { pipeline } from '@xenova/transformers';
import type { EmbeddingProvider } from './types.js';

export class TransformersEmbedder implements EmbeddingProvider {
  public readonly dimensions: number = 384;
  public readonly modelName: string = 'Xenova/all-MiniLM-L6-v2';
  private pipe: Awaited<ReturnType<typeof pipeline>> | null = null;
  private initPromise: Promise<void> | null = null;

  public async init(): Promise<void> {
    if (this.pipe) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.pipe = await pipeline('feature-extraction', this.modelName);
      })();
    }
    await this.initPromise;
  }

  public async embed(texts: string[]): Promise<number[][]> {
    await this.init();

    const embeddings: number[][] = [];
    for (const text of texts) {
      const output = await this.pipe(text, { pooling: 'mean', normalize: true });
      // output.data is Float32Array with length 384
      const vector = Array.from(output.data as Float32Array).slice(0, this.dimensions);
      embeddings.push(vector);
    }

    return embeddings;
  }
}
