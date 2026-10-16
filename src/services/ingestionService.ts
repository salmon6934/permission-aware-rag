import { z } from 'zod';
import { withTenantTransaction } from '../db/tenantDb.js';
import { parseDocument } from '../ingestion/parsers/index.js';
import { chunkText } from '../ingestion/chunker.js';
import { getEmbedder, type EmbeddingProvider } from './embedding/index.js';
import { ClearanceLevelSchema } from '../auth/types.js';

export const IngestionSchema = z.object({
  tenantId: z.string().uuid({ message: 'tenantId must be a valid UUID' }),
  filename: z.string().min(1, { message: 'filename cannot be empty' }),
  source: z.string().default('upload'),
  allowedRoles: z.array(z.string().min(1)).min(1, { message: 'allowedRoles must have at least one role' }),
  sensitivity: ClearanceLevelSchema,
});

export interface IngestionInput {
  tenantId: string;
  filename: string;
  source?: string;
  buffer: Buffer;
  mimeType: string;
  allowedRoles: string[];
  sensitivity: number;
  embedder?: EmbeddingProvider;
}

export interface IngestionResult {
  id: string;
  tenant_id: string;
  filename: string;
  status: string;
  chunk_count: number;
  acl: {
    allowed_roles: string[];
    sensitivity: number;
    acl_version: number;
  };
}

/**
 * Executes end-to-end document ingestion inside an isolated, tenant-scoped transaction.
 */
export async function ingestDocument(input: IngestionInput): Promise<IngestionResult> {
  const validated = IngestionSchema.parse({
    tenantId: input.tenantId,
    filename: input.filename,
    source: input.source ?? 'upload',
    allowedRoles: input.allowedRoles,
    sensitivity: input.sensitivity,
  });

  if (!input.buffer || input.buffer.length === 0) {
    throw new Error('File buffer is empty');
  }

  const activeEmbedder = input.embedder ?? getEmbedder();

  // 1. Parse text from buffer
  const extractedText = await parseDocument(input.buffer, input.mimeType, validated.filename);

  // 2. Split text into semantic chunks
  const chunks = chunkText(extractedText);
  if (chunks.length === 0) {
    throw new Error('Extracted text produced zero chunks');
  }

  // 3. Generate embeddings
  const chunkTexts = chunks.map((c) => c.text);
  const embeddings = await activeEmbedder.embed(chunkTexts);

  // 4. Persist document and all vector chunks in an atomic transaction
  return await withTenantTransaction(validated.tenantId, async (client) => {
    // Insert document record
    const docRes = await client.query<{ id: string; acl_version: number }>(
      `INSERT INTO documents (
        tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status
      ) VALUES ($1, $2, $3, $4, $5, 1, 'indexing')
      RETURNING id, acl_version;`,
      [
        validated.tenantId,
        validated.filename,
        validated.source,
        validated.allowedRoles,
        validated.sensitivity,
      ]
    );

    const docId = docRes.rows[0].id;
    const aclVersion = docRes.rows[0].acl_version;

    // Batch insert vector chunks in batches of 50
    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const sliceChunks = chunks.slice(i, i + batchSize);
      const sliceEmbeddings = embeddings.slice(i, i + batchSize);

      const valuePlaceholders: string[] = [];
      const queryParams: unknown[] = [];
      let paramCounter = 1;

      for (let j = 0; j < sliceChunks.length; j++) {
        const chunk = sliceChunks[j];
        const vector = sliceEmbeddings[j];
        const vectorStr = `[${vector.join(',')}]`;

        valuePlaceholders.push(
          `($${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4}, $${paramCounter + 5}, $${paramCounter + 6}, $${paramCounter + 7})`
        );

        queryParams.push(
          docId,
          validated.tenantId,
          validated.allowedRoles,
          validated.sensitivity,
          aclVersion,
          activeEmbedder.modelName,
          chunk.text,
          vectorStr
        );

        paramCounter += 8;
      }

      const insertQuery = `
        INSERT INTO chunks (
          doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding
        ) VALUES ${valuePlaceholders.join(', ')};
      `;

      await client.query(insertQuery, queryParams);
    }

    // Update document status to indexed
    await client.query(
      `UPDATE documents SET status = 'indexed' WHERE id = $1;`,
      [docId]
    );

    return {
      id: docId,
      tenant_id: validated.tenantId,
      filename: validated.filename,
      status: 'indexed',
      chunk_count: chunks.length,
      acl: {
        allowed_roles: validated.allowedRoles,
        sensitivity: validated.sensitivity,
        acl_version: aclVersion,
      },
    };
  });
}

/**
 * Deletes a document and cascades deletion to all child chunks within tenant scope.
 */
export async function deleteDocument(
  tenantId: string,
  documentId: string
): Promise<{ deleted: boolean }> {
  return await withTenantTransaction(tenantId, async (client) => {
    const res = await client.query<{ id: string }>(
      `DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING id;`,
      [documentId, tenantId]
    );

    return {
      deleted: res.rowCount !== null && res.rowCount > 0,
    };
  });
}

export interface UpdateAclInput {
  tenantId: string;
  documentId: string;
  allowedRoles?: string[];
  sensitivity?: number;
}

export interface UpdateAclResult {
  id: string;
  tenant_id: string;
  filename: string;
  allowed_roles: string[];
  sensitivity: number;
  acl_version: number;
}

/**
 * Atomically updates ACL permissions for a document and all child vector chunks,
 * bumping acl_version without recomputing vector embeddings.
 */
export async function updateDocumentAcl(
  input: UpdateAclInput
): Promise<UpdateAclResult | null> {
  const documentId = z.string().uuid().parse(input.documentId);
  const tenantId = z.string().uuid().parse(input.tenantId);

  return await withTenantTransaction(tenantId, async (client) => {
    // 1. Fetch current document state
    const currentRes = await client.query<{
      id: string;
      filename: string;
      allowed_roles: string[];
      sensitivity: number;
      acl_version: number;
    }>(
      `SELECT id, filename, allowed_roles, sensitivity, acl_version 
       FROM documents 
       WHERE id = $1 AND tenant_id = $2;`,
      [documentId, tenantId]
    );

    if (currentRes.rows.length === 0) {
      return null;
    }

    const currentDoc = currentRes.rows[0];
    const newRoles = input.allowedRoles ?? currentDoc.allowed_roles;
    const newSensitivity = input.sensitivity ?? currentDoc.sensitivity;
    const nextAclVersion = currentDoc.acl_version + 1;

    // Validate updated fields
    if (newRoles.length === 0) {
      throw new Error('allowed_roles cannot be empty');
    }
    if (newSensitivity < 0 || newSensitivity > 3) {
      throw new Error('sensitivity must be an integer between 0 and 3');
    }

    // 2. Update document metadata and bump acl_version
    await client.query(
      `UPDATE documents 
       SET allowed_roles = $1, sensitivity = $2, acl_version = $3
       WHERE id = $4 AND tenant_id = $5;`,
      [newRoles, newSensitivity, nextAclVersion, documentId, tenantId]
    );

    // 3. Update all child chunks in the exact same transaction without touching embeddings
    await client.query(
      `UPDATE chunks 
       SET allowed_roles = $1, sensitivity = $2, acl_version = $3
       WHERE doc_id = $4 AND tenant_id = $5;`,
      [newRoles, newSensitivity, nextAclVersion, documentId, tenantId]
    );

    return {
      id: documentId,
      tenant_id: tenantId,
      filename: currentDoc.filename,
      allowed_roles: newRoles,
      sensitivity: newSensitivity,
      acl_version: nextAclVersion,
    };
  });
}

