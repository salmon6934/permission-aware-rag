import type pg from 'pg';
import { z } from 'zod';
import { appPool } from './pool.js';

const TenantIdSchema = z.string().uuid({ message: 'Invalid tenantId: must be a valid UUID' });

/**
 * Hardened database access wrapper enforcing tenant-scoped transactions.
 *
 * Guarantees:
 * 1. Checks out connection from runtime pool.
 * 2. Begins explicit transaction with BEGIN.
 * 3. Applies transaction-scoped `set_config('app.tenant_id', $1, true)`.
 *    The `true` argument marks the setting as LOCAL to the current transaction.
 * 4. Automatically rolls back on any error.
 * 5. Commits on success.
 * 6. Always releases the connection back to the pool in a finally block.
 * 7. When the transaction finishes (COMMIT or ROLLBACK), PostgreSQL automatically
 *    clears `app.tenant_id`, guaranteeing zero session bleed across reused pooled connections.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  pool: pg.Pool = appPool
): Promise<T> {
  const validatedTenantId = TenantIdSchema.parse(tenantId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [validatedTenantId]);

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Suppress rollback errors to preserve the original exception
    }
    throw error;
  } finally {
    client.release();
  }
}
