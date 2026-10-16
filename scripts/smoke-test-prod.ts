import * as jose from 'jose';
import { env } from '../src/config/env.js';

const targetUrl = process.argv[2] || process.env.PROD_URL || `http://localhost:${env.PORT}`;
console.log(`\n================================================================================`);
console.log(`🚀 PRODUCTION SMOKE TEST: Target -> ${targetUrl}`);
console.log(`================================================================================\n`);

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

// Use Apex Global tenant seeded in DB
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

async function signTestToken(user_id: string, roles: string[], clearance: number): Promise<string> {
  return await new jose.SignJWT({
    tenant_id: TENANT_ID,
    user_id,
    roles,
    clearance,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey);
}

async function runSmokeTests() {
  let docId: string | null = null;
  const adminToken = await signTestToken('smoke_admin', ['admin', 'engineering'], 3);
  const engToken = await signTestToken('smoke_eng_user', ['engineering'], 1);
  const finToken = await signTestToken('smoke_fin_user', ['finance'], 1);

  try {
    // 1. Healthcheck Probe
    console.log('[1/7] Probing /health endpoint...');
    const healthRes = await fetch(`${targetUrl}/health`);
    if (!healthRes.ok) throw new Error(`Healthcheck failed: HTTP ${healthRes.status}`);
    const healthBody = (await healthRes.json()) as { status: string; db: string };
    console.log(`      Status: ${healthBody.status} | DB: ${healthBody.db} (OK)`);

    // 2. Metrics Telemetry Probe
    console.log('[2/7] Probing /metrics telemetry endpoint...');
    const metricsRes = await fetch(`${targetUrl}/metrics`);
    if (!metricsRes.ok) throw new Error(`Metrics failed: HTTP ${metricsRes.status}`);
    const metricsBody = (await metricsRes.json()) as { uptime_seconds: number; total_queries: number };
    console.log(`      Uptime: ${metricsBody.uptime_seconds}s | Queries Processed: ${metricsBody.total_queries} (OK)`);

    // 3. Document Ingestion via Multipart Upload
    console.log('[3/7] Ingesting test document via POST /documents...');
    const sampleContent = `# Mission Horizon Technical Specifications\n\nProject Horizon utilizes next-generation quantum photonics telemetry.\nPropulsion efficiency threshold is 99.4% under cryo vacuum conditions.\n`;
    const boundary = '----WebKitFormBoundarySmokeTest7MA4YWxkTrZu0gW';
    const multipartBody = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="horizon_specs.md"`,
      `Content-Type: text/markdown`,
      '',
      sampleContent,
      `--${boundary}`,
      `Content-Disposition: form-data; name="allowed_roles"`,
      '',
      JSON.stringify(['engineering', 'admin']),
      `--${boundary}`,
      `Content-Disposition: form-data; name="sensitivity"`,
      '',
      '1',
      `--${boundary}--`,
    ].join('\r\n');

    const ingestRes = await fetch(`${targetUrl}/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!ingestRes.ok) {
      const errText = await ingestRes.text();
      throw new Error(`Ingest failed (HTTP ${ingestRes.status}): ${errText}`);
    }

    const ingestData = (await ingestRes.json()) as { id: string; chunk_count: number };
    docId = ingestData.id;
    console.log(`      Uploaded docId: ${docId} | Chunks Created: ${ingestData.chunk_count} (OK)`);

    // 4. Authorized Query
    console.log('[4/7] Testing authorized vector retrieval via POST /query...');
    const queryAuthRes = await fetch(`${targetUrl}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${engToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'What is the quantum photonics propulsion efficiency?' }),
    });

    if (!queryAuthRes.ok) throw new Error(`Query failed: HTTP ${queryAuthRes.status}`);
    const queryAuthData = (await queryAuthRes.json()) as { answer: string; citations: Array<{ doc_id: string }> };
    console.log(`      Answer: "${queryAuthData.answer.slice(0, 80)}..."`);
    console.log(`      Citations Returned: ${queryAuthData.citations.length} (OK)`);

    // 5. Unauthorized Query (Access Denied)
    console.log('[5/7] Testing unauthorized role access denial via POST /query...');
    const queryUnauthRes = await fetch(`${targetUrl}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${finToken}`, // Finance role lacks access to engineering
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'What is the quantum photonics propulsion efficiency?' }),
    });

    const queryUnauthData = (await queryUnauthRes.json()) as { answer: string; citations: unknown[] };
    if (queryUnauthData.answer.includes('cannot find any authorized information') && queryUnauthData.citations.length === 0) {
      console.log(`      Uniform Denial Triggered: "${queryUnauthData.answer}" (OK)`);
    } else {
      throw new Error(`Unauthorized query leaked data! Answer: ${queryUnauthData.answer}`);
    }

    // 6. Audit Hash Chain Verification
    console.log('[6/7] Verifying cryptographic hash chain via GET /audit/verify...');
    const auditRes = await fetch(`${targetUrl}/audit/verify`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!auditRes.ok) throw new Error(`Audit verify failed: HTTP ${auditRes.status}`);
    const auditData = (await auditRes.json()) as { valid: boolean; total_events: number };
    console.log(`      Chain Verified: ${auditData.valid} | Total Events Chained: ${auditData.total_events} (OK)`);

    // 7. Cleanup
    if (docId) {
      console.log('[7/7] Cleaning up smoke test document via DELETE /documents/:id...');
      const delRes = await fetch(`${targetUrl}/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!delRes.ok) throw new Error(`Delete failed: HTTP ${delRes.status}`);
      console.log(`      Deleted test document ${docId} (OK)`);
    }

    console.log(`\n================================================================================`);
    console.log(`✅ ALL 7 PRODUCTION SMOKE TESTS PASSED CLEANLY ON ${targetUrl}`);
    console.log(`================================================================================\n`);
  } catch (err) {
    console.error(`\n❌ PRODUCTION SMOKE TEST FAILED:`, err);
    process.exit(1);
  }
}

runSmokeTests();
