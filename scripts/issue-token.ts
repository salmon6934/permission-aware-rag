import { signToken } from '../src/auth/jwt.js';
import type { Principal } from '../src/auth/types.js';

/**
 * Dev token generator CLI script.
 * Usage:
 *   npx tsx scripts/issue-token.ts [tenant_id] [user_id] [roles_csv] [clearance] [expiresIn]
 * Example:
 *   npx tsx scripts/issue-token.ts 11111111-1111-1111-1111-111111111111 alice engineering,member 2 24h
 */
async function main() {
  const args = process.argv.slice(2);

  const tenant_id = args[0] || '11111111-1111-1111-1111-111111111111';
  const user_id = args[1] || 'dev_user_1';
  const roles = (args[2] || 'admin,engineering').split(',').map((r) => r.trim());
  const clearance = parseInt(args[3] || '2', 10);
  const expiresIn = args[4] || '24h';

  const principal: Principal = {
    tenant_id,
    user_id,
    roles,
    clearance,
  };

  try {
    const token = await signToken(principal, { expiresIn });
    console.log('\n--- Generated Dev JWT ---');
    console.log(`Tenant ID  : ${tenant_id}`);
    console.log(`User ID    : ${user_id}`);
    console.log(`Roles      : ${roles.join(', ')}`);
    console.log(`Clearance  : ${clearance}`);
    console.log(`Expires In : ${expiresIn}`);
    console.log('\nToken:');
    console.log(token);
    console.log('-------------------------\n');
  } catch (err) {
    console.error('Failed to issue token:', err);
    process.exit(1);
  }
}

main();
