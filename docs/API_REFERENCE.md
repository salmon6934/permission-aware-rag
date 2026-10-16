# REST API Reference & Specification

All API endpoints are mounted on the Fastify gateway. Protected endpoints require an `Authorization: Bearer <JWT>` header containing a verified token issued by or compatible with the system's HMAC-SHA256 signer.

---

## 1. Authentication & Dev Tokens

### Issue Development Token
Generates a signed test JWT for arbitrary personas with custom tenant IDs, roles, and clearance levels.  
*Note: This endpoint is completely disabled in production environments (`NODE_ENV === 'production'`).*

- **URL:** `POST /dev/token`
- **Authentication:** Public (dev/test only)
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "tenant_id": "11111111-1111-1111-1111-111111111111",
    "user_id": "bob_eng",
    "roles": ["engineering"],
    "clearance": 1,
    "expiresIn": "1h"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "principal": {
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "user_id": "bob_eng",
        "roles": ["engineering"],
        "clearance": 1
      },
      "expiresIn": "1h"
    }
    ```
  - `400 Bad Request`: Payload validation error (e.g. invalid UUID, empty roles).

---

## 2. Document Management

### Ingest Document
Uploads, parses, chunks, embeds, and stores a document and its 384-dimensional vector embeddings within the caller's tenant boundary.

- **URL:** `POST /documents`
- **Authentication:** Bearer Token
- **Required Roles:** `editor` or `admin`
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `file`: The binary document (`.pdf`, `.docx`, `.md`, or `.txt`). Max 10MB.
  - `allowed_roles`: Array of role strings (e.g. `["engineering", "admin"]` or comma-separated).
  - `sensitivity`: Integer clearance level required (`0`, `1`, `2`, or `3`).
- **Responses:**
  - `201 Created`:
    ```json
    {
      "id": "d1111111-1111-1111-1111-111111111111",
      "tenant_id": "11111111-1111-1111-1111-111111111111",
      "filename": "quantum_specs.md",
      "status": "indexed",
      "chunk_count": 4,
      "acl": {
        "allowed_roles": ["engineering", "admin"],
        "sensitivity": 1,
        "acl_version": 1
      }
    }
    ```
  - `400 Bad Request`: Missing file, unsupported MIME type, or invalid ACL parameters.
  - `401 Unauthorized`: Missing, expired, or untrusted JWT.
  - `403 Forbidden`: Principal lacks `editor` or `admin` role.
  - `413 Payload Too Large`: Uploaded file exceeds 10MB limit.

---

### Update Document ACL
Atomically updates the access control list (roles and/or sensitivity) for a document and all child vector chunks without recomputing embeddings.

- **URL:** `PATCH /documents/:id/acl`
- **Authentication:** Bearer Token
- **Required Roles:** `admin`
- **Path Parameters:**
  - `id`: UUID of the target document.
- **Request Body:**
  ```json
  {
    "allowed_roles": ["finance", "admin"],
    "sensitivity": 2
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "message": "Document ACL updated successfully",
      "document": {
        "id": "d1111111-1111-1111-1111-111111111111",
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "filename": "quarterly_budget.md",
        "allowed_roles": ["finance", "admin"],
        "sensitivity": 2,
        "acl_version": 2
      }
    }
    ```
  - `404 Not Found`: Document not found or belongs to a different tenant.

---

### Delete Document
Cascades deletion of a document and all its corresponding vector chunks from the active HNSW index.

- **URL:** `DELETE /documents/:id`
- **Authentication:** Bearer Token
- **Required Roles:** `admin`
- **Path Parameters:**
  - `id`: UUID of the target document.
- **Responses:**
  - `200 OK`:
    ```json
    {
      "id": "d1111111-1111-1111-1111-111111111111",
      "deleted": true,
      "message": "Document and associated vector chunks deleted successfully"
    }
    ```
  - `404 Not Found`: Document not found or belongs to another tenant.

---

## 3. RAG Query & Inference

### Query Knowledge Base
Executes permission-aware filtered retrieval, constructs isolated context prompts, and generates cited LLM answers.

- **URL:** `POST /query`
- **Authentication:** Bearer Token
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "query": "What are the Project Titan delivery milestones?",
    "limit": 5
  }
  ```
- **Responses:**
  - `200 OK (Authorized Information Found)`:
    ```json
    {
      "answer": "Project Titan delivery milestone is scheduled for Q4 [Doc: d1111111-1111..., Chunk: c1111111-1111...].",
      "model": "hosted-gemini/gemini-1.5-flash",
      "citations": [
        {
          "doc_id": "d1111111-1111-1111-1111-111111111111",
          "chunk_id": "c1111111-1111-1111-1111-111111111101",
          "similarity": 0.8841
        }
      ],
      "query_hash": "a1b2c3d4e5f6...",
      "request_id": "req-98fbc12a"
    }
    ```
  - `200 OK (Access Denied / Insufficient Authorized Chunks)`:
    ```json
    {
      "answer": "I cannot find any authorized information to answer your query.",
      "citations": [],
      "query_hash": "e7f8a9b0c1d2...",
      "request_id": "req-43a18e02"
    }
    ```
  - `503 Service Unavailable`: LLM provider unreachable or rate-limited after retries.

---

## 4. Audit & Verification

### Retrieve Audit Logs
Fetches paginated audit events for the authenticated caller's tenant.

- **URL:** `GET /audit?limit=50&offset=0`
- **Authentication:** Bearer Token
- **Required Roles:** `admin`
- **Responses:**
  - `200 OK`:
    ```json
    {
      "tenant_id": "11111111-1111-1111-1111-111111111111",
      "limit": 50,
      "offset": 0,
      "count": 2,
      "events": [
        {
          "seq": 2,
          "timestamp": "2026-10-17T00:15:30.123Z",
          "user_id": "bob_eng",
          "roles": ["engineering"],
          "clearance": 1,
          "query_hash": "a1b2c3d4e5...",
          "applied_filter": {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "roles": ["engineering"],
            "clearance": 1
          },
          "returned_chunk_ids": ["c1111111-1111..."],
          "generation_occurred": true,
          "prev_hash": "e4f5a6...",
          "entry_hash": "f8a9b0..."
        }
      ]
    }
    ```

---

### Verify Cryptographic Audit Chain
Traverses and recomputes the SHA-256 hash chain from sequence 1 to the latest event, detecting any unauthorized database mutations.

- **URL:** `GET /audit/verify`
- **Authentication:** Bearer Token
- **Required Roles:** `admin`
- **Responses:**
  - `200 OK (Untampered Chain)`:
    ```json
    {
      "valid": true,
      "tenant_id": "11111111-1111-1111-1111-111111111111",
      "total_events": 142,
      "message": "Cryptographic hash chain is intact and fully verified from genesis."
    }
    ```
  - `409 Conflict (Tampering Detected)`:
    ```json
    {
      "valid": false,
      "message": "Cryptographic audit hash chain verification failed: tampering detected",
      "details": {
        "valid": false,
        "totalEvents": 142,
        "brokenSeq": 2,
        "expectedHash": "a3b4c5...",
        "actualHash": "e8f9a0...",
        "message": "Tampered payload detected at seq 2: hash does not match canonical payload"
      }
    }
    ```

---

## 5. Observability & Health

### Operational Metrics
- **URL:** `GET /metrics`
- **Authentication:** Public
- **Response:**
  ```json
  {
    "uptime_seconds": 3600,
    "total_requests": 1250,
    "total_queries": 840,
    "successful_generations": 710,
    "denied_or_empty_queries": 130,
    "llm_retry_count": 4,
    "avg_query_latency_ms": 112.45,
    "timestamp": "2026-10-17T01:30:00.000Z"
  }
  ```

### Health Check
- **URL:** `GET /health`
- **Authentication:** Public
- **Response:**
  ```json
  {
    "status": "ok",
    "db": "connected"
  }
  ```
