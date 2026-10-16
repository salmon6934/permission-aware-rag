-- =============================================================================
-- Supabase Role Setup Script for Permission-Aware Multi-Tenant RAG
-- =============================================================================
-- Run this script in the Supabase SQL Editor (as the superuser/postgres role)
-- BEFORE running `npm run migrate`.
--
-- PURPOSE:
-- Creates the restricted runtime database user ('app_user') ensuring it has
-- NOBYPASSRLS and NOSUPERUSER privileges, and grants appropriate permissions.
-- =============================================================================

-- 1. Ensure required extensions are active
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create the restricted application runtime role if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        -- IMPORTANT: Replace 'YOUR_APP_USER_PASSWORD_HERE' with a strong random secret
        CREATE ROLE app_user WITH LOGIN PASSWORD 'YOUR_APP_USER_PASSWORD_HERE' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE 
            NOBYPASSRLS;
        RAISE NOTICE 'Role app_user created successfully with NOBYPASSRLS.';
    ELSE
        -- Ensure role is explicitly stripped of bypass permissions if it existed
        ALTER ROLE app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        RAISE NOTICE 'Role app_user already exists; verified NOBYPASSRLS privileges.';
    END IF;
END
$$;

-- 3. Grant connection privileges on the database
GRANT CONNECT ON DATABASE postgres TO app_user;

-- 4. Grant schema usage
GRANT USAGE ON SCHEMA public TO app_user;

-- 5. Grant appropriate table permissions (for when tables are migrated)
-- Note: Tables will be created by the 'postgres' migration role.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_user;
GRANT INSERT, UPDATE, DELETE ON TABLE documents TO app_user;
GRANT INSERT, UPDATE, DELETE ON TABLE chunks TO app_user;
GRANT INSERT ON TABLE audit_events TO app_user;

-- 6. Strictly revoke mutation rights on audit_events
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE tenants FROM app_user;

-- 7. Grant default privileges so future tables created by migrations inherit permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 8. Verify the configuration
SELECT 
    rolname, 
    rolsuper, 
    rolbypassrls, 
    rolcanlogin 
FROM pg_roles 
WHERE rolname IN ('postgres', 'app_user');
