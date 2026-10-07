import { buildApp } from './app.js';
import { env } from './config/env.js';
import { assertRuntimeRolePrivileges } from './db/pool.js';

async function start() {
  const app = buildApp();

  try {
    // Assert runtime database role privileges before accepting traffic
    console.log('Verifying runtime database role privileges (app_user NOBYPASSRLS check)...');
    await assertRuntimeRolePrivileges();
    console.log('Database role privileges verified: app_user is properly restricted without BYPASSRLS.');

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`Server listening at http://localhost:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

start();
