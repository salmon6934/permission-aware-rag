# Portfolio & Interview Reference Guide: Permission-Aware Multi-Tenant RAG

## 1. High-Impact Resume Bullet Points

- **Architected and built an enterprise-grade multi-tenant RAG platform in Node.js/TypeScript and PostgreSQL + pgvector**, achieving zero cross-tenant leakage across adversarial security evaluations.
- **Engineered in-query vector authorization pushdown (`allowed_roles && $1 AND sensitivity <= $2`) with HNSW graph tuning (`ef_search = 100`)**, eliminating post-filtering recall starvation and achieving **100.0% recall** against brute-force scan.
- **Enforced database-level multi-tenant isolation using PostgreSQL Row-Level Security (RLS)**, combined with restricted application roles (`NOBYPASSRLS`) and transaction-scoped configuration bindings (`set_config(..., true)`) to prevent session bleed across pooled connections.
- **Designed a tamper-evident, SHA-256 hash-chained audit logging pipeline**, using PostgreSQL advisory transaction locks for sequence serialization, append-only triggers, and streaming cursor verification.
- **Built an adversarial security test suite covering 10 threat scenarios**, including prompt injection context boundary breakout, token tampering, parameter pollution, and zero-day existence oracle attacks (100% automated pass in GitHub Actions CI).

---

## 2. 60-Second Technical Pitch

> *"Most enterprise RAG applications fail because they treat security as an afterthought—either post-filtering vectors in memory, which starves search recall, or running separate database clusters for every tenant, which destroys unit economics.*
>
> *I designed and built **Permission-Aware Multi-Tenant RAG**, a production-grade system that guarantees zero-leakage multi-tenancy on shared infrastructure. Instead of naively fetching top-k vectors and pruning them in code, my architecture pushes role overlap and clearance levels directly into the pgvector HNSW search query while dynamically tuning graph search depth (`ef_search = 100`) to guarantee 100% recall.*
>
> *On the database tier, PostgreSQL Row-Level Security and transaction-scoped session bindings make cross-tenant data leaks physically impossible at the connection level. Every query is logged into an append-only, SHA-256 hash-chained audit ledger that mathematically flags unauthorized database tampering. The entire system is validated by an automated adversarial suite simulating cross-tenant attacks, token tampering, and prompt boundary escapes."*

---

## 3. LinkedIn & GitHub Project Summaries

### GitHub Short Description
> Production-grade Permission-Aware Multi-Tenant RAG system with in-query pgvector authorization, PostgreSQL Row Level Security (RLS), in-process transformers.js embeddings, and tamper-evident SHA-256 hash-chained audit logging.

### LinkedIn Post Draft
> Enterprise AI adoption is stalling for one primary reason: **Data Security & Permission Boundaries**.
> 
> Naive RAG setups often leak confidential documents or executive memos across organizational boundaries, and "post-filtering" results in memory causes massive recall starvation where users receive zero search results for documents they are authorized to see.
> 
> To solve this, I designed and built an open-source, production-ready **Permission-Aware Multi-Tenant RAG System**:
> 
> 🛡️ **In-Query Permission Enforcement:** Vector distance (`<=>`), RBAC role overlap (`&&`), and sensitivity clearance (`<=`) evaluate atomically in the HNSW index scan.  
> 🔒 **PostgreSQL Row Level Security (RLS):** Restricted runtime database roles (`NOBYPASSRLS`) with transaction-scoped configs guarantee zero session bleed across pooled connections.  
> ⚡ **In-Process Embeddings:** Lightweight 384-dimensional vectorization (`all-MiniLM-L6-v2`) running directly in Node.js via `transformers.js`.  
> ⛓️ **Tamper-Evident Audit Trails:** Every query is cryptographically chained via SHA-256 hashes with database triggers strictly prohibiting UPDATE or DELETE.  
> 🧪 **Battle-Tested:** 85/85 automated tests passing across 20 test files, including 10 adversarial leakage attack scenarios.
> 
> Check out the architecture, threat model, and source code on GitHub: [github.com/salmon6934/permission-aware-rag](https://github.com/salmon6934/permission-aware-rag)

---

## 4. Key Architectural Talking Points for Technical Interviews

### Q: Why not just do vector retrieval first and filter by user roles in application memory?
> *"Post-filtering causes severe recall starvation. If the top 10 vector neighbors all belong to confidential documents, the post-filter drops all 10 chunks, returning zero results even if an authorized document is ranked 11th. In our system, permissions are evaluated inside the HNSW query WHERE clause before top-k truncation, completely avoiding candidate starvation."*

### Q: How do you prevent connection pool session leaks with PostgreSQL RLS?
> *"Naive implementations use `SET app.tenant_id = '...'`, which permanently alters the connection's session state. When that connection is returned to the pool and borrowed by another tenant, cross-tenant leakage occurs. We created `withTenantTransaction`: every query runs inside an explicit `BEGIN` block using `SELECT set_config('app.tenant_id', $1, true)`. The `true` parameter makes the variable local to that transaction only. The moment `COMMIT` or `ROLLBACK` runs, PostgreSQL automatically purges the tenant identity."*

### Q: How does the tamper-evident audit log work?
> *"Each tenant maintains a cryptographic hash chain. Each event entry hashes the previous event's hash combined with canonical JSON of the current event: `SHA-256(prev_hash || canonical_json(entry))`. We serialize sequence assignment per-tenant using transaction advisory locks (`pg_advisory_xact_lock(hashtext(tenantId))`) without table-level locking. Database triggers block UPDATE and DELETE queries. Our `GET /audit/verify` endpoint walks the chain using cursor streaming to prove mathematical continuity from genesis."*
