import { migratorPool } from '../src/db/pool.js';
import { recordAuditEvent, verifyAuditChain } from '../src/services/auditLogger.js';
import type { Principal } from '../src/auth/types.js';

const DEMO_TENANT_ID = '33333333-3333-3333-3333-333333333333';

const adminPrincipal: Principal = {
  tenant_id: DEMO_TENANT_ID,
  user_id: 'security_auditor_01',
  roles: ['admin', 'auditor'],
  clearance: 3,
};

async function runTamperDemo(): Promise<void> {
  const client = await migratorPool.connect();
  try {
    // 1. Setup tenant
    await client.query(`
      INSERT INTO tenants (id, name, config)
      VALUES ('${DEMO_TENANT_ID}', 'Sentinel CyberSec', '{}')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Clean prior demo runs
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
    await client.query(`DELETE FROM audit_events WHERE tenant_id = '${DEMO_TENANT_ID}';`);
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');

    console.log('\n' + '='.repeat(80));
    console.log('  CRYPTOGRAPHIC HASH-CHAIN AUDIT TAMPER DEMONSTRATION');
    console.log('='.repeat(80));
    console.log('Recording 3 sequential audit log events into append-only ledger...\n');

    // 2. Record 3 chained audit events
    await recordAuditEvent({
      tenantId: DEMO_TENANT_ID,
      principal: adminPrincipal,
      query: 'Query 1: Session authentication & security authorization check',
      requestId: 'req-audit-001',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000001'],
      aclVersions: [1],
      generationOccurred: true,
    });

    await recordAuditEvent({
      tenantId: DEMO_TENANT_ID,
      principal: adminPrincipal,
      query: 'Query 2: Executive offshore financial transfer authorization',
      requestId: 'req-audit-002',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000002'],
      aclVersions: [1],
      generationOccurred: true,
    });

    await recordAuditEvent({
      tenantId: DEMO_TENANT_ID,
      principal: adminPrincipal,
      query: 'Query 3: Automated compliance report export',
      requestId: 'req-audit-003',
      returnedChunkIds: ['00000000-0000-0000-0000-000000000003'],
      aclVersions: [1],
      generationOccurred: true,
    });

    // 3. Display pristine chain
    const rowsRes = await client.query(`
      SELECT seq, user_id, query_hash, prev_hash, entry_hash
      FROM audit_events
      WHERE tenant_id = '${DEMO_TENANT_ID}'
      ORDER BY seq ASC;
    `);

    console.log('Pristine Audit Log Sequence:');
    for (const row of rowsRes.rows) {
      console.log(`[Seq ${row.seq}] User: ${row.user_id}`);
      console.log(`  Prev Hash : ${row.prev_hash.slice(0, 24)}...`);
      console.log(`  Entry Hash: ${row.entry_hash.slice(0, 24)}...\n`);
    }

    const preVerify = await verifyAuditChain(DEMO_TENANT_ID);
    console.log(`Initial Verification Status: [${preVerify.valid ? 'VALID ✓' : 'FAILED ✗'}]`);
    console.log(`Chain Integrity: Fully verified from genesis across ${preVerify.totalEvents} events.\n`);

    // 4. Attack Simulation
    console.log('-'.repeat(80));
    console.log('ATTACK SIMULATION: Rogue DB Admin bypasses application and mutates Seq 2...');
    console.log('-'.repeat(80));

    await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
    await client.query(`
      UPDATE audit_events
      SET query_hash = 'b45c26982f6e7f1234567890abcdef1234567890abcdef1234567890abcdef12'
      WHERE tenant_id = '${DEMO_TENANT_ID}' AND seq = 2;
    `);
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');
    console.log('Database row directly updated in PostgreSQL: query_hash modified.\n');

    // 5. Verification after attack
    console.log('Executing Cryptographic Verification (verifyAuditChain)...');
    const postVerify = await verifyAuditChain(DEMO_TENANT_ID);

    if (!postVerify.valid) {
      console.log(`\nVerification Result: [TAMPERING DETECTED ✗]`);
      console.log(`  Broken Sequence : Event #${postVerify.brokenSeq}`);
      console.log(`  Expected Hash   : ${postVerify.expectedHash}`);
      console.log(`  Actual Stored   : ${postVerify.actualHash}`);
      console.log(`  Diagnostics     : ${postVerify.error}`);
    } else {
      console.log('Verification unexpectedly succeeded.');
    }

    // 6. Cleanup
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');
    await client.query(`DELETE FROM audit_events WHERE tenant_id = '${DEMO_TENANT_ID}';`);
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');
    await client.query(`DELETE FROM tenants WHERE id = '${DEMO_TENANT_ID}';`);

    console.log('\n' + '='.repeat(80));
    console.log('DEMO COMPLETE: Cryptographic hash chaining successfully exposed payload tampering.');
    console.log('='.repeat(80) + '\n');
  } finally {
    client.release();
    await migratorPool.end();
  }
}

runTamperDemo().catch((err) => {
  console.error('Tamper demo execution failed:', err);
  process.exit(1);
});
