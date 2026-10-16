import crypto from 'node:crypto';
import stringify from 'fast-json-stable-stringify';
import type pg from 'pg';
import { withTenantTransaction } from '../db/tenantDb.js';
import type { Principal } from '../auth/types.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditLogInput {
  tenantId: string;
  principal: Principal;
  query: string;
  requestId: string;
  returnedChunkIds: string[];
  aclVersions: number[];
  generationOccurred: boolean;
  error?: string;
}

export interface AuditEventRecord {
  id: string;
  seq: number;
  timestamp: string;
  tenant_id: string;
  user_id: string;
  roles: string[];
  clearance: number;
  query_hash: string;
  applied_filter: Record<string, unknown>;
  returned_chunk_ids: string[];
  acl_versions: number[];
  request_id: string;
  generation_occurred: boolean;
  prev_hash: string;
  entry_hash: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalEvents: number;
  brokenSeq?: number;
  expectedHash?: string;
  actualHash?: string;
  message?: string;
  error?: string;
}

/**
 * Computes deterministic SHA-256 hash of a query string.
 */
export function computeQueryHash(query: string): string {
  return crypto.createHash('sha256').update(query.trim()).digest('hex');
}

/**
 * Computes deterministic SHA-256 hash of an audit event chained to prev_hash.
 */
export function computeEntryHash(prevHash: string, entryPayload: Record<string, unknown>): string {
  const canonicalJson = stringify(entryPayload);
  return crypto
    .createHash('sha256')
    .update(prevHash + canonicalJson)
    .digest('hex');
}

/**
 * Appends a tamper-evident, hash-chained audit event for the tenant.
 */
export async function recordAuditEvent(
  input: AuditLogInput,
  existingClient?: pg.PoolClient
): Promise<AuditEventRecord> {
  const queryHash = computeQueryHash(input.query);

  const appliedFilter: Record<string, unknown> = {
    tenant_id: input.tenantId,
    roles: input.principal.roles,
    clearance: input.principal.clearance,
  };

  if (input.error) {
    appliedFilter.error = input.error;
  }

  const executor = async (client: pg.PoolClient): Promise<AuditEventRecord> => {
    // 1. Fetch tenant config to check if full query text logging is enabled
    const tenantRes = await client.query<{ config: Record<string, unknown> }>(
      'SELECT config FROM tenants WHERE id = $1',
      [input.tenantId]
    );
    const tenantConfig = tenantRes.rows[0]?.config || {};
    if (tenantConfig.audit_log_query_text === true) {
      appliedFilter.raw_query = input.query;
    }

    // 2. Acquire transaction-level advisory lock on the tenant ID to serialize sequence generation
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1));`, [input.tenantId]);

    // Fetch the latest audit event for this tenant
    const latestRes = await client.query<{ seq: string; entry_hash: string }>(
      `SELECT seq, entry_hash 
       FROM audit_events 
       WHERE tenant_id = $1 
       ORDER BY seq DESC 
       LIMIT 1;`,
      [input.tenantId]
    );

    const latest = latestRes.rows[0];
    const seq = latest ? Number(latest.seq) + 1 : 1;
    const prevHash = latest ? latest.entry_hash : GENESIS_HASH;
    const timestamp = new Date().toISOString();

    // 3. Construct canonical entry payload for hashing (excluding hashes themselves)
    const entryPayload = {
      seq,
      timestamp,
      tenant_id: input.tenantId,
      user_id: input.principal.user_id,
      roles: input.principal.roles,
      clearance: input.principal.clearance,
      query_hash: queryHash,
      applied_filter: appliedFilter,
      returned_chunk_ids: input.returnedChunkIds,
      acl_versions: input.aclVersions,
      request_id: input.requestId,
      generation_occurred: input.generationOccurred,
    };

    const entryHash = computeEntryHash(prevHash, entryPayload);

    // 4. Insert immutable record
    const insertRes = await client.query<AuditEventRecord>(
      `INSERT INTO audit_events (
        seq, timestamp, tenant_id, user_id, roles, clearance, query_hash,
        applied_filter, returned_chunk_ids, acl_versions, request_id,
        generation_occurred, prev_hash, entry_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;`,
      [
        seq,
        timestamp,
        input.tenantId,
        input.principal.user_id,
        input.principal.roles,
        input.principal.clearance,
        queryHash,
        appliedFilter,
        input.returnedChunkIds,
        input.aclVersions,
        input.requestId,
        input.generationOccurred,
        prevHash,
        entryHash,
      ]
    );

    return insertRes.rows[0];
  };

  if (existingClient) {
    return await executor(existingClient);
  }

  return await withTenantTransaction(input.tenantId, executor);
}

/**
 * Validates the complete cryptographic hash chain for a tenant from seq = 1 to end.
 */
export async function verifyAuditChain(tenantId: string): Promise<AuditVerificationResult> {
  return await withTenantTransaction(tenantId, async (client) => {
    const res = await client.query<AuditEventRecord>(
      `SELECT * FROM audit_events 
       WHERE tenant_id = $1 
       ORDER BY seq ASC;`,
      [tenantId]
    );

    const events = res.rows;
    if (events.length === 0) {
      return { valid: true, totalEvents: 0 };
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const expectedSeq = i + 1;

      // 1. Verify sequence continuity
      if (Number(event.seq) !== expectedSeq) {
        return {
          valid: false,
          totalEvents: events.length,
          brokenSeq: Number(event.seq),
          message: `Broken sequence detected at index ${i}: expected seq ${expectedSeq}, found ${event.seq}`,
        };
      }

      // 2. Verify prev_hash matches previous entry_hash
      if (event.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalEvents: events.length,
          brokenSeq: Number(event.seq),
          expectedHash: expectedPrevHash,
          actualHash: event.prev_hash,
          message: `Broken prev_hash chain link at seq ${event.seq}`,
        };
      }

      // 3. Recompute canonical entry_hash
      const entryPayload = {
        seq: Number(event.seq),
        timestamp: new Date(event.timestamp).toISOString(),
        tenant_id: event.tenant_id,
        user_id: event.user_id,
        roles: event.roles,
        clearance: event.clearance,
        query_hash: event.query_hash,
        applied_filter: event.applied_filter,
        returned_chunk_ids: event.returned_chunk_ids,
        acl_versions: event.acl_versions,
        request_id: event.request_id,
        generation_occurred: event.generation_occurred,
      };

      const computedHash = computeEntryHash(event.prev_hash, entryPayload);

      if (computedHash !== event.entry_hash) {
        return {
          valid: false,
          totalEvents: events.length,
          brokenSeq: Number(event.seq),
          expectedHash: computedHash,
          actualHash: event.entry_hash,
          message: `Tampered payload detected at seq ${event.seq}: hash does not match canonical payload`,
        };
      }

      expectedPrevHash = event.entry_hash;
    }

    return {
      valid: true,
      totalEvents: events.length,
    };
  });
}

/**
 * Returns paginated audit events for a tenant.
 */
export async function getAuditLogs(
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<AuditEventRecord[]> {
  return await withTenantTransaction(tenantId, async (client) => {
    const res = await client.query<AuditEventRecord>(
      `SELECT * FROM audit_events 
       WHERE tenant_id = $1 
       ORDER BY seq DESC 
       LIMIT $2 OFFSET $3;`,
      [tenantId, limit, offset]
    );

    return res.rows;
  });
}
