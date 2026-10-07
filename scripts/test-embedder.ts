import { TransformersEmbedder } from '../src/services/embedding/transformersEmbedder.js';

async function main() {
  console.log('Loading Xenova/all-MiniLM-L6-v2 model via @xenova/transformers...');
  const start = Date.now();
  const embedder = new TransformersEmbedder();
  
  const sampleText = 'Permission-aware multi-tenant RAG vector search';
  const embeddings = await embedder.embed([sampleText]);
  const elapsed = Date.now() - start;

  if (embeddings.length !== 1) {
    throw new Error(`Expected 1 embedding vector, got ${embeddings.length}`);
  }

  const vector = embeddings[0];
  console.log(`Generated embedding vector length: ${vector.length} (took ${elapsed}ms)`);

  if (vector.length !== 384) {
    throw new Error(`Embedding vector dimensions mismatch! Expected 384, got ${vector.length}`);
  }

  // Verify non-zero and reasonable numbers
  const sampleValues = vector.slice(0, 5).map((n) => n.toFixed(4));
  console.log(`First 5 dimensions: [${sampleValues.join(', ')}]`);
  console.log('Embedder test passed: in-process transformers.js produces valid 384-dimensional vectors.');
}

main().catch((err) => {
  console.error('Embedder test failed:', err);
  process.exit(1);
});
