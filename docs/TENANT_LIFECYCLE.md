# Tenant Lifecycle, Data Erasure & Compliance Architecture

## 1. Overview & Regulatory Conflict
In enterprise multi-tenant architectures, data lifecycle management sits at the intersection of two conflicting regulatory mandates:
1. **Right to Be Forgotten (GDPR Art. 17 / CCPA):** Tenants and users have the right to demand complete erasure of personal data, uploaded documents, proprietary IP, and embeddings.
2. **Immutable Audit Accountability (SOC 2, ISO 27001, HIPAA):** Organizations must maintain verifiable, tamper-evident records proving who accessed what systems, when, and whether unauthorized attempts occurred.

This document formalizes how the Permission-Aware RAG system resolves this conflict through deterministic cascading erasure, mathematical vector unlearning, and privacy-preserving audit pseudonymous retention.

---

## 2. Document & Vector Chunk Erasure

### Cascade Deletion Mechanics
When an authorized administrator deletes a document via `DELETE /documents/:id`, the system leverages relational foreign key cascades defined in PostgreSQL:

```sql
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ...
);
```

### Execution Flow:
1. **Tenant-Scoped Authorization:** The request is authenticated, verified to have the `admin` role, and executed strictly inside `withTenantTransaction(tenant_id, ...)`.
2. **Atomic Cascade:**
   ```sql
   DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING id;
   ```
3. **Engine-Level Cleanup:**
   - The parent row in `documents` is deleted.
   - All associated child vector rows in `chunks` are instantly wiped by PostgreSQL's relational engine (`ON DELETE CASCADE`).
   - The corresponding vector entries in the HNSW cosine index (`idx_chunks_embedding_hnsw`) are removed from active traversal paths.
4. **Immediate Vector Unlearning:** Subsequent queries within the exact same transaction or immediately thereafter can no longer traverse or return these chunks (verified in `tests/acl-lifecycle.test.ts` and `tests/leakage.test.ts`).

---

## 3. Complete Tenant Offboarding & Purging

When an entire tenant offboards or terminates their contract, a full tenant purge is executed:

### Step 1: Administrative Tenant Deletion
```sql
DELETE FROM tenants WHERE id = $target_tenant_id;
```
Because `documents.tenant_id` and `chunks.tenant_id` reference `tenants(id)` with `ON DELETE CASCADE`, this single transaction deletes:
- All tenant configuration records.
- All documents belonging to the tenant.
- All 384-dimensional chunk embeddings.

### Step 2: Audit Trail Retention & Pseudonymization
Under SOC 2 Type II and compliance requirements, audit trails (`audit_events`) cannot be silently modified or truncated without breaking the cryptographic SHA-256 chain of custody.

The system handles tenant offboarding without leaking PII:
- **Zero Raw Chunk Text:** The audit log **never** stores raw chunk content, decrypted sentences, or user documents.
- **Query Hash Preservation:** Raw query strings are hashed with SHA-256 (`query_hash = SHA-256(query)`), preventing query reversal while preserving tamper evidence.
- **Archival Export:** Before tenant termination, the tenant's complete cryptographically verified audit trail (`GET /audit/verify`) can be exported to cold archival storage (e.g., S3 Glacier in compliance mode / Object Lock) and signed with an administrative HSM key.

---

## 4. ACL Permission Lifecycle & Revocation

Permissions can change without requiring vector re-embedding. When roles or clearance levels are modified:

### PATCH /documents/:id/acl
```json
{
  "allowed_roles": ["finance"],
  "sensitivity": 2
}
```

1. **Zero-Latency Invalidation:** In a single atomic transaction:
   - `documents.allowed_roles` and `documents.sensitivity` are updated.
   - `documents.acl_version` is bumped ($V \to V + 1$).
   - All associated rows in `chunks` have their `allowed_roles`, `sensitivity`, and `acl_version` synchronized.
   - Vector embeddings remain unchanged.
2. **Instant Recall Lockout:** Any subsequent query from a persona lacking the newly assigned role or clearance level immediately fails closed without cache invalidation delays.

---

## 5. Compliance Matrix

| Regulation / Standard | Requirement | System Implementation |
| :--- | :--- | :--- |
| **GDPR Art. 17** | Erasure of Personal Data | Relational `ON DELETE CASCADE` wipes document text and all high-dimensional vector representations. |
| **GDPR Art. 25** | Data Protection by Design & Default | In-query permission pushdown prevents unauthorized chunks from entering LLM context or network responses. |
| **SOC 2 CC6.1** | Logical Access Controls | RLS policies (`app_user` with `NOBYPASSRLS`), JWT claim validation, and RBAC clearance guards. |
| **SOC 2 CC6.8** | Tamper-Evident System Audit | SHA-256 hash-chained log (`audit_events`) with database triggers strictly prohibiting `UPDATE` and `DELETE`. |
| **HIPAA Security Rule** | Minimum Necessary Disclosure | Vector retrieval bounded strictly by user clearance (0–3); query denials return byte-identical fallback responses to prevent presence oracles. |
