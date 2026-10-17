/**
 * Declassified Records Office Frontend Application Logic
 */

const API_BASE = window.location.origin;

// Classification labels, color mappings, and stamps
const CLASSIFICATIONS = {
  0: { name: 'PUBLIC', colorClass: 'level-0', desc: 'General Access' },
  1: { name: 'INTERNAL', colorClass: 'level-1', desc: 'Staff Only' },
  2: { name: 'CONFIDENTIAL', colorClass: 'level-2', desc: 'Management & Ops' },
  3: { name: 'RESTRICTED', colorClass: 'level-3', desc: 'Executive Eyes Only' },
};

// Default seed personas
const DEFAULT_PERSONAS = [
  {
    id: 'badge-1',
    name: 'Alice Vance',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    org_name: 'Apex Global Inc',
    roles: ['engineering'],
    clearance: 1, // Internal
    token: null,
  },
  {
    id: 'badge-2',
    name: 'Bob Sterling',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    org_name: 'Apex Global Inc',
    roles: ['finance'],
    clearance: 2, // Confidential
    token: null,
  },
  {
    id: 'badge-3',
    name: 'Charlie Cross',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    org_name: 'Apex Global Inc',
    roles: ['executive', 'admin'],
    clearance: 3, // Restricted
    token: null,
  },
  {
    id: 'badge-4',
    name: 'Dave Vance',
    tenant_id: '22222222-2222-2222-2222-222222222222',
    org_name: 'Nexus Dynamics LLC',
    roles: ['engineering', 'finance'],
    clearance: 3, // Restricted but foreign tenant!
    token: null,
  },
];

let activePersonas = [];
let selectedFile = null;

// Initialize on page load (empty by default - add manually)
window.addEventListener('DOMContentLoaded', async () => {
  renderPersonas();
  pollTelemetry();
  setInterval(pollTelemetry, 8000);
});

// View Navigation
function switchView(viewName) {
  document.getElementById('view-dashboard').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-audit').classList.add('hidden');

  document.getElementById('nav-btn-dashboard').classList.remove('active');
  document.getElementById('nav-btn-admin').classList.remove('active');
  document.getElementById('nav-btn-audit').classList.remove('active');

  if (viewName === 'dashboard') {
    document.getElementById('view-dashboard').classList.remove('hidden');
    document.getElementById('nav-btn-dashboard').classList.add('active');
  } else if (viewName === 'admin') {
    document.getElementById('view-admin').classList.remove('hidden');
    document.getElementById('nav-btn-admin').classList.add('active');
    loadTenantDocuments();
  } else if (viewName === 'audit') {
    document.getElementById('view-audit').classList.remove('hidden');
    document.getElementById('nav-btn-audit').classList.add('active');
    loadAuditLedger();
  }
}

function switchAdminTab(tabName) {
  document.getElementById('tab-ingest-btn').classList.remove('active');
  document.getElementById('tab-records-btn').classList.remove('active');
  document.getElementById('admin-tab-ingest').classList.add('hidden');
  document.getElementById('admin-tab-records').classList.add('hidden');

  if (tabName === 'ingest') {
    document.getElementById('tab-ingest-btn').classList.add('active');
    document.getElementById('admin-tab-ingest').classList.remove('hidden');
  } else {
    document.getElementById('tab-records-btn').classList.add('active');
    document.getElementById('admin-tab-records').classList.remove('hidden');
    loadTenantDocuments();
  }
}

// Telemetry Polling
async function pollTelemetry() {
  try {
    const [healthRes, metricsRes] = await Promise.all([
      fetch(`${API_BASE}/health`),
      fetch(`${API_BASE}/metrics`),
    ]);

    if (healthRes.ok) {
      const h = await healthRes.json();
      document.getElementById('telemetry-health').innerText = `DB: ${h.db.toUpperCase()}`;
    }

    if (metricsRes.ok) {
      const m = await metricsRes.json();
      document.getElementById('telemetry-queries').innerText = `QUERIES: ${m.total_queries}`;
    }
  } catch (err) {
    document.getElementById('telemetry-health').innerText = 'STATUS: OFFLINE';
  }
}

// Persona & Token Management
async function seedDefaultPersonas() {
  activePersonas = JSON.parse(JSON.stringify(DEFAULT_PERSONAS));
  // Issue tokens for all badges in parallel
  await Promise.all(
    activePersonas.map(async (persona) => {
      persona.token = await fetchToken(persona);
    })
  );
  renderPersonas();
}

async function fetchToken(persona) {
  try {
    const res = await fetch(`${API_BASE}/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: persona.tenant_id,
        user_id: persona.name.toLowerCase().replace(/\s+/g, '_'),
        roles: persona.roles,
        clearance: persona.clearance,
      }),
    });
    if (!res.ok) throw new Error('Token issue failed');
    const data = await res.json();
    return data.token;
  } catch {
    return null;
  }
}

function renderPersonas() {
  const container = document.getElementById('persona-grid-container');
  container.innerHTML = '';
  document.getElementById('badge-count-label').innerText = `${activePersonas.length} / 4 BADGES`;

  if (activePersonas.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: var(--panel-white); border: 2px dashed var(--border-subtle); padding: 48px 24px; text-align: center; border-radius: 4px;">
        <div style="font-size: 28px; margin-bottom: 8px;">📇</div>
        <div style="font-weight: 800; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
          NO USERS ADDED YET
        </div>
        <div style="font-family: var(--font-typewriter); font-size: 13px; color: var(--ink-muted); max-width: 480px; margin: 0 auto 16px;">
          Click "Add User" to create up to 4 users with different roles and clearance levels, then compare their responses side-by-side.
        </div>
        <button class="btn-dispatch" style="margin: 0 auto;" onclick="openAddPersonaModal()">
          <span>➕</span> ADD FIRST USER
        </button>
      </div>
    `;
    return;
  }

  activePersonas.forEach((persona, index) => {
    const classMeta = CLASSIFICATIONS[persona.clearance] || CLASSIFICATIONS[0];
    const barcode = `ID-${persona.tenant_id.substring(0, 4)}-${persona.roles[0].substring(0, 3).toUpperCase()}-L${persona.clearance}`;

    const badge = document.createElement('div');
    badge.className = 'id-badge';
    badge.id = `persona-card-${persona.id}`;
    badge.innerHTML = `
      <div class="badge-lanyard-slot"></div>
      <div class="clearance-stripe ${classMeta.colorClass}"></div>

      <div class="badge-header">
        <div class="badge-top-row">
          <div>
            <div class="badge-name">${escapeHtml(persona.name)}</div>
            <div class="badge-org">${escapeHtml(persona.org_name)}</div>
          </div>
          <span class="badge-stamp ${classMeta.colorClass}">
            LEVEL ${persona.clearance}: ${classMeta.name}
          </span>
        </div>

        <div class="badge-meta-row">
          ${persona.roles.map(r => `<span class="role-chip">${escapeHtml(r)}</span>`).join('')}
          <span class="barcode-text">${barcode}</span>
          ${activePersonas.length > 0 ? `<button onclick="removePersona(${index})" style="background: none; border: none; font-size: 13px; font-weight: bold; color: var(--ink-muted); cursor: pointer; margin-left: 6px;" title="Remove User">✕</button>` : ''}
        </div>
      </div>

      <div class="badge-body">
        <div class="typed-record-box" id="output-${persona.id}">
          <div class="typed-record-placeholder">
            [WAITING FOR QUESTION]
          </div>
        </div>

        <form class="badge-query-form" onsubmit="handleSingleQuery(event, ${index})">
          <input 
            type="text" 
            id="query-input-${persona.id}"
            class="badge-query-input" 
            placeholder="Ask a question for this user..."
          />
          <button type="submit" class="badge-query-btn">ASK</button>
        </form>
      </div>
    `;
    container.appendChild(badge);
  });
}

function setBroadcastPrompt(prompt) {
  document.getElementById('broadcast-input').value = prompt;
  handleBroadcastQuery();
}

async function handleBroadcastQuery() {
  const query = document.getElementById('broadcast-input').value.trim();
  if (!query) return;

  activePersonas.forEach((persona, index) => {
    dispatchQueryToPersona(persona, query);
  });
}

async function handleSingleQuery(e, index) {
  e.preventDefault();
  const persona = activePersonas[index];
  const input = document.getElementById(`query-input-${persona.id}`);
  const query = input.value.trim();
  if (!query) return;
  dispatchQueryToPersona(persona, query);
}

// Core Query Dispatcher & Declassification Redaction Renderer
async function dispatchQueryToPersona(persona, query) {
  const outputBox = document.getElementById(`output-${persona.id}`);
  outputBox.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; color: var(--ink-muted); font-size: 11px;">
      <span class="telemetry-dot" style="background: var(--ink-navy);"></span>
      SEARCHING DOCUMENTS & CHECKING PERMISSIONS...
    </div>
  `;

  try {
    if (!persona.token) {
      persona.token = await fetchToken(persona);
    }

    const res = await fetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${persona.token}`,
      },
      body: JSON.stringify({ query }),
    });

    const data = await res.json();

    // Check if query was blocked or returned fallback denial
    const isDenial = !res.ok || data.answer.includes('cannot find any authorized information') || data.citations.length === 0;

    if (isDenial) {
      // Visual Redaction Bar Metaphor
      outputBox.innerHTML = `
        <div style="margin-bottom: 8px; font-weight: 700; color: var(--redaction-black);">
          ANSWER:
        </div>
        <div style="font-size: 11px; line-height: 1.8;">
          ${data.answer || 'Access denied by permissions.'}
        </div>
        <div class="redaction-notice">
          <span class="redaction-notice-icon">█</span>
          <span>HIDDEN BY PERMISSIONS: Requires higher clearance or different roles than Level ${persona.clearance} (${persona.roles.join(', ')})</span>
        </div>
        <div style="margin-top: 10px;">
          <span class="redaction-bar">████████████████████████████████</span>
          <span class="redaction-bar">████████████████████</span>
        </div>
      `;
    } else {
      // Answer with Document Excerpts
      let citationsHtml = '';
      if (data.citations && data.citations.length > 0) {
        citationsHtml = `
          <div class="excerpt-dossier">
            <div class="excerpt-header">
              <span>MATCHING DOCUMENT EXCERPTS (${data.citations.length})</span>
            </div>
            ${data.citations.map((c, i) => {
              const sens = CLASSIFICATIONS[c.sensitivity] || CLASSIFICATIONS[0];
              return `
                <div class="excerpt-carbon ${sens.colorClass}">
                  <div style="margin-bottom: 4px;">
                    <span class="excerpt-stamp-tag" style="background: ${sens.colorClass === 'level-0' ? '#DCFCE7' : sens.colorClass === 'level-1' ? '#DBEAFE' : sens.colorClass === 'level-2' ? '#FEF3C7' : '#FEE2E2'}; color: var(--ink-navy);">
                      ${escapeHtml(c.filename || 'RECORD_' + (i+1))} // LEVEL ${c.sensitivity}
                    </span>
                    <span style="font-size: 9px; color: var(--ink-muted);">
                      SIMILARITY: ${(c.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style="font-size: 10px; color: #2B384A; font-style: italic;">
                    "${escapeHtml(c.text ? c.text.substring(0, 160) + '...' : 'Excerpt text securely retrieved')}"
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      outputBox.innerHTML = `
        <div style="margin-bottom: 6px; font-weight: 700; color: var(--ink-navy); display: flex; justify-content: space-between;">
          <span>AUTHORIZED RESPONSE:</span>
          <span style="font-size: 9px; color: var(--ink-muted); text-transform: uppercase;">
            ${escapeHtml(data.model || 'Groq Hosted LLM')}
          </span>
        </div>
        <div style="font-size: 12px; line-height: 1.6; color: var(--ink-navy);">
          ${escapeHtml(data.answer)}
        </div>
        ${citationsHtml}
      `;
    }
  } catch (err) {
    outputBox.innerHTML = `
      <div style="color: var(--class-restricted); font-size: 11px;">
        DISPATCH ERROR: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// Modal Handlers
function openAddPersonaModal() {
  if (activePersonas.length >= 4) {
    alert('Maximum 4 personnel badges can be active simultaneously.');
    return;
  }
  document.getElementById('modal-add-persona').classList.remove('hidden');
}

function closeAddPersonaModal() {
  document.getElementById('modal-add-persona').classList.add('hidden');
}

async function handleCreatePersona(e) {
  e.preventDefault();
  const name = document.getElementById('modal-persona-name').value.trim();
  const tenant_id = document.getElementById('modal-persona-tenant').value;
  const org_name = tenant_id === '11111111-1111-1111-1111-111111111111' ? 'Apex Global Inc' : 'Nexus Dynamics LLC';
  const clearance = parseInt(document.getElementById('modal-persona-clearance').value, 10);
  const roles = Array.from(document.querySelectorAll('input[name="modal_roles"]:checked')).map(cb => cb.value);

  if (roles.length === 0) {
    alert('Please select at least one assigned role.');
    return;
  }

  const newPersona = {
    id: `badge-${Date.now()}`,
    name,
    tenant_id,
    org_name,
    roles,
    clearance,
    token: null,
  };

  newPersona.token = await fetchToken(newPersona);
  activePersonas.push(newPersona);
  closeAddPersonaModal();
  renderPersonas();
}

function removePersona(index) {
  activePersonas.splice(index, 1);
  renderPersonas();
}

// Filing Desk & Document Ingestion
function handleFileSelected(e) {
  selectedFile = e.target.files[0];
  if (selectedFile) {
    document.getElementById('file-label').innerText = `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`;
  }
}

async function handleDocumentUpload(e) {
  e.preventDefault();
  if (!selectedFile) {
    alert('Please select a file to archive.');
    return;
  }

  const tenantId = document.getElementById('ingest-tenant').value;
  const sensitivity = parseInt(document.getElementById('ingest-sensitivity').value, 10);
  const checkedRoles = Array.from(document.querySelectorAll('input[name="ingest_roles"]:checked')).map(cb => cb.value);

  if (checkedRoles.length === 0) {
    alert('Please select at least one authorized role.');
    return;
  }

  // Generate temporary admin token for ingestion
  const adminToken = await fetchToken({
    tenant_id: tenantId,
    roles: ['admin', 'editor'],
    clearance: 3,
    name: 'admin',
  });

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('sensitivity', sensitivity.toString());
  checkedRoles.forEach(r => formData.append('allowed_roles', r));

  try {
    const res = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Ingestion failed');
    }

    alert('Document indexed and stamped successfully!');
    selectedFile = null;
    document.getElementById('file-label').innerText = 'SELECT RECORD TO ARCHIVE';
    document.getElementById('ingest-form').reset();
    switchAdminTab('records');
  } catch (err) {
    alert(`Failed to archive document: ${err.message}`);
  }
}

async function loadTenantDocuments() {
  const tableBody = document.getElementById('records-table-body');
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Loading archive deposits...</td></tr>`;

  const adminToken = await fetchToken({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    roles: ['admin'],
    clearance: 3,
    name: 'admin',
  });

  try {
    const res = await fetch(`${API_BASE}/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();

    if (!data.documents || data.documents.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--ink-muted);">No records found in this repository.</td></tr>`;
      return;
    }

    tableBody.innerHTML = data.documents.map(d => {
      const sens = CLASSIFICATIONS[d.sensitivity] || CLASSIFICATIONS[0];
      return `
        <tr>
          <td style="font-weight: 700;">${escapeHtml(d.filename)}</td>
          <td>
            <span class="excerpt-stamp-tag ${sens.colorClass}" style="background: ${sens.colorClass === 'level-0' ? '#DCFCE7' : sens.colorClass === 'level-1' ? '#DBEAFE' : sens.colorClass === 'level-2' ? '#FEF3C7' : '#FEE2E2'}; color: var(--ink-navy);">
              LEVEL ${d.sensitivity} // ${sens.name}
            </span>
          </td>
          <td>${d.allowed_roles.map(r => `<span class="role-chip">${escapeHtml(r)}</span>`).join(' ')}</td>
          <td>${d.chunk_count || 1} chunks</td>
          <td><span style="color: var(--class-public); font-weight: 700;">INDEXED</span></td>
          <td class="text-right">
            <button class="btn-secondary" style="display: inline-block; padding: 3px 8px; font-size: 11px;" onclick="deleteRecord('${d.id}')">
              PURGE
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color: var(--class-restricted);">Failed to load archive: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function deleteRecord(docId) {
  if (!confirm('Are you sure you want to purge this record and cascade delete all its vector embeddings?')) return;

  const adminToken = await fetchToken({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    roles: ['admin'],
    clearance: 3,
    name: 'admin',
  });

  try {
    const res = await fetch(`${API_BASE}/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error('Delete failed');
    loadTenantDocuments();
  } catch (err) {
    alert(`Could not purge record: ${err.message}`);
  }
}

// Audit Ledger Verification
async function loadAuditLedger() {
  const tableBody = document.getElementById('audit-table-body');
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Loading immutable audit events...</td></tr>`;

  const adminToken = await fetchToken({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    roles: ['admin'],
    clearance: 3,
    name: 'admin',
  });

  try {
    const res = await fetch(`${API_BASE}/audit?limit=25`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();

    if (!data.events || data.events.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center;">No audit events recorded yet.</td></tr>`;
      return;
    }

    tableBody.innerHTML = data.events.map(ev => {
      return `
        <tr>
          <td style="font-weight: 700;">#${ev.seq}</td>
          <td style="color: var(--ink-muted);">${new Date(ev.timestamp).toLocaleTimeString()}</td>
          <td style="font-weight: 700;">${escapeHtml(ev.user_id)}</td>
          <td>
            ${ev.roles.map(r => `<span class="role-chip">${escapeHtml(r)}</span>`).join('')}
            <span style="font-size: 10px; margin-left: 4px;">L${ev.clearance}</span>
          </td>
          <td style="font-size: 10px; color: var(--ink-muted);">${escapeHtml(ev.request_id.substring(0, 12))}...</td>
          <td style="font-size: 10px;">
            <span style="color: #64748B;">${ev.prev_hash.substring(0, 8)}...</span> ➔ 
            <span style="font-weight: 700; color: var(--ink-navy);">${ev.entry_hash.substring(0, 8)}...</span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color: var(--class-restricted);">Failed to load audit events: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function verifyAuditLedger() {
  const banner = document.getElementById('audit-verification-banner');
  banner.style.display = 'block';
  banner.style.background = 'var(--bg-concrete-light)';
  banner.style.border = '1px solid var(--ink-navy)';
  banner.innerHTML = 'Executing SHA-256 cryptographic hash chain verification...';

  const adminToken = await fetchToken({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    roles: ['admin'],
    clearance: 3,
    name: 'admin',
  });

  try {
    const res = await fetch(`${API_BASE}/audit/verify`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();

    if (data.valid) {
      banner.style.background = 'var(--class-public-bg)';
      banner.style.borderColor = 'var(--class-public)';
      banner.style.color = '#14532D';
      banner.innerHTML = `✅ CRYPTOGRAPHIC INTEGRITY VERIFIED: All ${data.events_verified || 'historical'} entries form an unbroken SHA-256 hash chain with 0 tampering.`;
    } else {
      banner.style.background = 'var(--class-restricted-bg)';
      banner.style.borderColor = 'var(--class-restricted)';
      banner.style.color = '#7F1D1D';
      banner.innerHTML = `🚨 TAMPERING DETECTED: Cryptographic sequence hash mismatch at seq #${data.broken_seq}!`;
    }
  } catch (err) {
    banner.style.background = 'var(--class-restricted-bg)';
    banner.style.color = '#7F1D1D';
    banner.innerHTML = `Verification error: ${escapeHtml(err.message)}`;
  }
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
