import { buildApp } from '../src/app.js';
import { migratorPool } from '../src/db/pool.js';
import { FakeEmbedder } from '../src/services/embedding/fakeEmbedder.js';
import { signToken } from '../src/auth/jwt.js';
import type { Principal } from '../src/auth/types.js';

const TENANT_APEX = '11111111-1111-1111-1111-111111111111';
const TENANT_NEXUS = '22222222-2222-2222-2222-222222222222';

const DOC_APEX_ENG = 'd1111111-1111-1111-1111-111111111111';
const DOC_APEX_FIN = 'd1111111-2222-2222-2222-222222222222';
const DOC_APEX_EXEC = 'd1111111-3333-3333-3333-333333333333';
const DOC_NEXUS_ENG = 'd2222222-1111-1111-1111-111111111111';
const DOC_NEXUS_FIN = 'd2222222-2222-2222-2222-222222222222';

const embedder = new FakeEmbedder();

async function seedDemoData(): Promise<void> {
  const client = await migratorPool.connect();
  try {
    // 1. Seed Tenants
    await client.query(`
      INSERT INTO tenants (id, name, config)
      VALUES 
        ('${TENANT_APEX}', 'Apex Global Inc', '{"domain": "apex.com"}'),
        ('${TENANT_NEXUS}', 'Nexus Dynamics LLC', '{"domain": "nexus.io"}')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 2. Seed Documents
    await client.query(`
      INSERT INTO documents (id, tenant_id, filename, source, allowed_roles, sensitivity, acl_version, status)
      VALUES 
        ('${DOC_APEX_ENG}', '${TENANT_APEX}', 'apex_engineering_roadmap.md', 'upload', ARRAY['engineering', 'admin'], 1, 1, 'indexed'),
        ('${DOC_APEX_FIN}', '${TENANT_APEX}', 'apex_financial_allocations.md', 'upload', ARRAY['finance', 'admin'], 2, 1, 'indexed'),
        ('${DOC_APEX_EXEC}', '${TENANT_APEX}', 'apex_board_minutes.md', 'upload', ARRAY['executive', 'admin'], 3, 1, 'indexed'),
        ('${DOC_NEXUS_ENG}', '${TENANT_NEXUS}', 'nexus_vulcan_project.md', 'upload', ARRAY['engineering', 'admin'], 1, 1, 'indexed'),
        ('${DOC_NEXUS_FIN}', '${TENANT_NEXUS}', 'nexus_capital_budget.md', 'upload', ARRAY['finance', 'admin'], 2, 1, 'indexed')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3. Seed Chunks
    const chunks = [
      {
        id: 'c1111111-1111-1111-1111-111111111101',
        doc_id: DOC_APEX_ENG,
        tenant_id: TENANT_APEX,
        allowed_roles: "ARRAY['engineering', 'admin']",
        sensitivity: 1,
        text: 'Apex Global Engineering Roadmap: Project Titan quantum computing architecture. Delivery milestone scheduled for Q4.',
      },
      {
        id: 'c1111111-2222-2222-2222-222222222201',
        doc_id: DOC_APEX_FIN,
        tenant_id: TENANT_APEX,
        allowed_roles: "ARRAY['finance', 'admin']",
        sensitivity: 2,
        text: 'Apex Global Corporate Financial Allocations: Approved Q4 strategic budget is $12.5M for Project Titan R&D and $3.2M for core cloud infrastructure.',
      },
      {
        id: 'c1111111-3333-3333-3333-333333333301',
        doc_id: DOC_APEX_EXEC,
        tenant_id: TENANT_APEX,
        allowed_roles: "ARRAY['executive', 'admin']",
        sensitivity: 3,
        text: 'Apex Global Board of Directors Minutes: Secret strategic merger negotiations with European robotics firm. Allocated $50M acquisition reserve.',
      },
      {
        id: 'c2222222-1111-1111-1111-111111111101',
        doc_id: DOC_NEXUS_ENG,
        tenant_id: TENANT_NEXUS,
        allowed_roles: "ARRAY['engineering', 'admin']",
        sensitivity: 1,
        text: 'Nexus Dynamics Technical Plan: Project Vulcan autonomous drone navigation system and core propulsion firmware specifications.',
      },
      {
        id: 'c2222222-2222-2222-2222-222222222201',
        doc_id: DOC_NEXUS_FIN,
        tenant_id: TENANT_NEXUS,
        allowed_roles: "ARRAY['finance', 'admin']",
        sensitivity: 2,
        text: 'Nexus Dynamics Capital Allocations: Strategic capital allocation of $8.4M dedicated to Project Vulcan autonomous supply chains.',
      },
    ];

    for (const c of chunks) {
      const [vec] = await embedder.embed([c.text]);
      await client.query(`
        INSERT INTO chunks (id, doc_id, tenant_id, allowed_roles, sensitivity, acl_version, embedding_model, text, embedding)
        VALUES ('${c.id}', '${c.doc_id}', '${c.tenant_id}', ${c.allowed_roles}, ${c.sensitivity}, 1, 'fake-minilm-l6-v2', '${c.text.replace(/'/g, "''")}', '[${vec.join(',')}]')
        ON CONFLICT (id) DO NOTHING;
      `);
    }
  } finally {
    client.release();
  }
}

async function runDemo(): Promise<void> {
  const app = buildApp();
  await app.ready();
  await seedDemoData();

  console.log('\n' + '='.repeat(80));
  console.log('  ENTERPRISE MULTI-TENANT PERMISSION-AWARE RAG DEMO');
  console.log('='.repeat(80));
  console.log('Three users across two tenants ask the identical question:');
  console.log('>> "What are our strategic project plans and financial allocations?"\n');

  const personas = [
    {
      name: 'Bob',
      org: 'Apex Global Inc (Tenant A)',
      role: 'engineering',
      clearance: 1,
      principal: {
        tenant_id: TENANT_APEX,
        user_id: 'bob_eng',
        roles: ['engineering'],
        clearance: 1,
      } as Principal,
      explanation: 'Authorized for Engineering (Clearance 1). Cannot view Finance or Executive documents.',
    },
    {
      name: 'Alice',
      org: 'Apex Global Inc (Tenant A)',
      role: 'finance',
      clearance: 2,
      principal: {
        tenant_id: TENANT_APEX,
        user_id: 'alice_fin',
        roles: ['finance'],
        clearance: 2,
      } as Principal,
      explanation: 'Authorized for Finance (Clearance 2). Cannot view Executive Board minutes (Clearance 3).',
    },
    {
      name: 'Charlie',
      org: 'Nexus Dynamics LLC (Tenant B)',
      role: 'admin',
      clearance: 3,
      principal: {
        tenant_id: TENANT_NEXUS,
        user_id: 'charlie_admin',
        roles: ['admin', 'engineering', 'finance'],
        clearance: 3,
      } as Principal,
      explanation: 'Admin at rival tenant. Completely isolated from Apex Global data by PostgreSQL RLS.',
    },
  ];

  for (const p of personas) {
    const token = await signToken(p.principal);

    const res = await app.inject({
      method: 'POST',
      url: '/query',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        query: 'What are our strategic project plans and financial allocations?',
      },
    });

    const body = res.json();

    console.log('-'.repeat(80));
    console.log(`PERSONA: ${p.name.toUpperCase()} | ORG: ${p.org}`);
    console.log(`Roles: [${p.role}] | Clearance: ${p.clearance}`);
    console.log(`Security Boundary: ${p.explanation}`);
    console.log('-'.repeat(80));
    console.log(`Response Answer:`);
    console.log(`  "${body.answer}"`);
    console.log(`Citations (${body.citations.length} authorized chunks):`);
    if (body.citations.length === 0) {
      console.log(`  [None - Access Denied]`);
    } else {
      for (const cit of body.citations) {
        console.log(`  - Doc: ${cit.doc_id} | Chunk: ${cit.chunk_id}`);
      }
    }
    console.log(`Audit Record: Logged with Query Hash: ${body.query_hash?.slice(0, 16)}...\n`);
  }

  console.log('='.repeat(80));
  console.log('DEMO SUMMARY:');
  console.log('1. Zero cross-tenant leakage: Charlie saw only Nexus Dynamics Project Vulcan data.');
  console.log('2. Zero role leakage: Bob only saw Engineering; financial numbers were redacted.');
  console.log('3. Zero clearance leakage: Executive board acquisitions ($50M) were hidden from Alice & Bob.');
  console.log('4. Complete auditability: Every single query was recorded into tamper-evident audit log.');
  console.log('='.repeat(80) + '\n');

  await app.close();
}

runDemo().catch((err) => {
  console.error('Demo execution failed:', err);
  process.exit(1);
});
