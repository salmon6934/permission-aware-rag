import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// Pool for migrations and administrative setup (schema owner / migrator)
export const migratorPool = new Pool({
  connectionString: env.DATABASE_URL,
});

// Hardened runtime application pool (restricted app_user without BYPASSRLS)
export const appPool = new Pool({
  connectionString: env.DATABASE_APP_URL,
});

/**
 * Startup assertion: Verifies that the connected runtime role does NOT possess
 * BYPASSRLS or SUPERUSER privileges. If it does, fails closed immediately.
 */
export async function assertRuntimeRolePrivileges(pool: pg.Pool = appPool): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`
      SELECT 
        current_user,
        r.rolsuper,
        r.rolbypassrls
      FROM pg_roles r
      WHERE r.rolname = current_user;
    `);

    if (res.rows.length === 0) {
      throw new Error('Fatal security check: Current user role not found in pg_roles.');
    }

    const { current_user, rolsuper, rolbypassrls } = res.rows[0];

    if (rolsuper) {
      throw new Error(
        `Fatal security violation: Runtime user '${current_user}' has SUPERUSER privilege! RLS can be bypassed. Process terminating.`,
      );
    }

    if (rolbypassrls) {
      throw new Error(
        `Fatal security violation: Runtime user '${current_user}' has BYPASSRLS privilege! Row Level Security is compromised. Process terminating.`,
      );
    }
  } finally {
    client.release();
  }
}
