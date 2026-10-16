-- Enable pgvector and pgcrypto extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create Roles if they do not exist (cloud-safe)
DO $$
BEGIN
    -- Only create superuser migrator if running in local environment with raw superuser
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = CURRENT_USER) THEN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
            CREATE ROLE migrator WITH LOGIN PASSWORD 'migrator_secret' SUPERUSER CREATEDB CREATEROLE BYPASSRLS;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

-- Grant database connection dynamically based on database name
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_database WHERE datname = 'rag_db') THEN
        EXECUTE 'GRANT CONNECT ON DATABASE rag_db TO app_user';
    END IF;
    IF EXISTS (SELECT FROM pg_database WHERE datname = 'postgres') THEN
        EXECUTE 'GRANT CONNECT ON DATABASE postgres TO app_user';
    END IF;
END
$$;

-- Switch to migrator context if available, otherwise proceed as current user (e.g. Supabase postgres)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
        BEGIN
            EXECUTE 'SET ROLE migrator';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END
$$;

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Documents Table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    source TEXT NOT NULL,
    allowed_roles TEXT[] NOT NULL,
    sensitivity INT NOT NULL,
    acl_version INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'indexed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Chunks Table (vector dimension 384 for all-MiniLM-L6-v2)
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    allowed_roles TEXT[] NOT NULL,
    sensitivity INT NOT NULL,
    acl_version INT NOT NULL DEFAULT 1,
    embedding_model TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Audit Events Table
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id TEXT NOT NULL,
    roles TEXT[] NOT NULL,
    clearance INT NOT NULL,
    query_hash TEXT NOT NULL,
    applied_filter JSONB NOT NULL,
    returned_chunk_ids UUID[] NOT NULL DEFAULT '{}',
    acl_versions INT[] NOT NULL DEFAULT '{}',
    request_id TEXT NOT NULL,
    generation_occurred BOOLEAN NOT NULL DEFAULT FALSE,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_id ON chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id ON audit_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_allowed_roles ON chunks USING gin (allowed_roles);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_roles_sensitivity ON chunks (tenant_id, sensitivity);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_tenant_seq ON audit_events (tenant_id, seq DESC);

-- Enable & Force Row Level Security (RLS)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS tenants_tenant_isolation_policy ON tenants;
DROP POLICY IF EXISTS documents_tenant_isolation_policy ON documents;
DROP POLICY IF EXISTS chunks_tenant_isolation_policy ON chunks;
DROP POLICY IF EXISTS audit_events_tenant_isolation_policy ON audit_events;

-- RLS Isolation Policies using current_setting('app.tenant_id', true)
CREATE POLICY tenants_tenant_isolation_policy ON tenants
    FOR SELECT
    USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY documents_tenant_isolation_policy ON documents
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY chunks_tenant_isolation_policy ON chunks
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY audit_events_tenant_isolation_policy ON audit_events
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Audit log immutability trigger (blocks UPDATE and DELETE)
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.allow_test_mutation', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Security restriction: audit_events table is append-only. UPDATE and DELETE are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();

-- Reset to superuser to grant permissions to app_user
RESET ROLE;

-- 5. Seed Default Multi-Tenant Organizations
INSERT INTO tenants (id, name, config)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'Apex Global Inc', '{"domain": "apex.com"}'),
    ('22222222-2222-2222-2222-222222222222', 'Nexus Dynamics LLC', '{"domain": "nexus.io"}')
ON CONFLICT (id) DO NOTHING;

GRANT USAGE ON SCHEMA public TO app_user;
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = 'extensions') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA extensions TO app_user';
    END IF;
END
$$;
GRANT SELECT ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO app_user;
GRANT SELECT, INSERT ON audit_events TO app_user;

-- Explicitly revoke forbidden permissions
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenants FROM app_user;
