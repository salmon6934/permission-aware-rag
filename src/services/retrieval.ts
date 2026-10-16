import { z } from 'zod';
import { withTenantTransaction } from '../db/tenantDb.js';
import { getEmbedder, type EmbeddingProvider } from './embedding/index.js';
import type { Principal } from '../auth/types.js';

export interface RetrievalQuery {
  query: string;
  principal: Principal;
  limit?: number;
  embedder?: EmbeddingProvider;
  efSearch?: number;
}

export interface RetrievedChunk {
  id: string;
  doc_id: string;
  text: string;
  allowed_roles: string[];
  sensitivity: number;
  acl_version: number;
  embedding_model: string;
  similarity: number;
}

const QuerySchema = z.string().min(1, { message: 'Query string cannot be empty' });
const LimitSchema = z.number().int().min(1).max(50).default(5);
const EfSearchSchema = z.number().int().min(10).max(500).default(100);

/**
 * Executes permission-aware filtered vector retrieval using pgvector HNSW.
 *
 * Guarantees:
 * 1. Filter predicates (tenant_id, allowed_roles, sensitivity) are constructed purely
 *    from the verified Principal claims—zero client filter overrides.
 * 2. In-query authorization: filtering occurs in the vector query WHERE clause before
 *    top-k truncation, completely avoiding post-filtering recall starvation.
 * 3. HNSW tuning: sets `SET LOCAL hnsw.ef_search = 100` within the transaction to maintain
 *    high recall under selective metadata filters.
 */
export async function retrieveChunks(options: RetrievalQuery): Promise<RetrievedChunk[]> {
  const queryText = QuerySchema.parse(options.query.trim());
  const limit = LimitSchema.parse(options.limit ?? 5);
  const efSearch = EfSearchSchema.parse(options.efSearch ?? 100);
  const { principal } = options;

  const embedder = options.embedder ?? getEmbedder();

  // 1. Vectorize query text in-process
  const embeddings = await embedder.embed([queryText]);
  if (!embeddings || embeddings.length === 0 || embeddings[0].length !== 384) {
    throw new Error('Embedder failed to generate 384-dimensional query vector');
  }

  const queryVectorStr = `[${embeddings[0].join(',')}]`;

  // 2. Execute retrieval inside tenant-scoped transaction
  return await withTenantTransaction(principal.tenant_id, async (client) => {
    // Tune HNSW search depth for this transaction
    await client.query(`SET LOCAL hnsw.ef_search = ${efSearch};`);

    // In-query vector search combining vector distance (<=>), array overlap (&&), and scalar comparison (<=)
    const sql = `
      SELECT 
        id, 
        doc_id, 
        text, 
        allowed_roles, 
        sensitivity, 
        acl_version, 
        embedding_model,
        ROUND((1 - (embedding <=> $1::extensions.vector))::numeric, 4)::float AS similarity
      FROM chunks
      WHERE tenant_id = $2
        AND allowed_roles && $3
        AND sensitivity <= $4
      ORDER BY embedding <=> $1::extensions.vector
      LIMIT $5;
    `;

    const result = await client.query<{
      id: string;
      doc_id: string;
      text: string;
      allowed_roles: string[];
      sensitivity: number;
      acl_version: number;
      embedding_model: string;
      similarity: number;
    }>(sql, [
      queryVectorStr,
      principal.tenant_id,
      principal.roles,
      principal.clearance,
      limit,
    ]);

    return result.rows;
  });
}
