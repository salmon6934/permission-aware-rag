import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratorPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const client = await migratorPool.connect();
  try {
    const migrationFile = path.join(__dirname, 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log(`Running migration: ${migrationFile}...`);
    await client.query(sql);
    console.log('Migration completed successfully.');
  } finally {
    client.release();
  }
}

// Allow direct execution: `tsx src/db/migrate.ts`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await migratorPool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await migratorPool.end();
      process.exit(1);
    });
}
