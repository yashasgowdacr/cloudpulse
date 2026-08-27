-- Enable pgcrypto extension for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status);

-- 2. Refresh Tokens Table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);

-- 3. Azure Connections Table (Phase 4B)
CREATE TABLE IF NOT EXISTS azure_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_name VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    iv VARCHAR(32) NOT NULL,
    auth_tag VARCHAR(32) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISCONNECTED', 'INVALID_CREDENTIALS', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_subscription UNIQUE (user_id, subscription_id)
);

-- Idempotent column migration for existing azure_connections table
ALTER TABLE azure_connections
  ADD COLUMN IF NOT EXISTS encrypted_client_secret TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS iv VARCHAR(32) NOT NULL,
  ADD COLUMN IF NOT EXISTS auth_tag VARCHAR(32) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_azure_connections_user_id ON azure_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_azure_connections_user_status ON azure_connections (user_id, status);

-- 4. Optimization Policies Table (Phase 4D)
CREATE TABLE IF NOT EXISTS optimization_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idle_cpu_threshold NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    monitoring_window_minutes INTEGER NOT NULL DEFAULT 30,
    auto_shutdown BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_optimization_policy_user UNIQUE (user_id),
    CONSTRAINT chk_idle_cpu_threshold CHECK (idle_cpu_threshold >= 0 AND idle_cpu_threshold <= 100),
    CONSTRAINT chk_monitoring_window_minutes CHECK (monitoring_window_minutes >= 5 AND monitoring_window_minutes <= 1440)
);

CREATE INDEX IF NOT EXISTS idx_optimization_policies_user_id ON optimization_policies(user_id);

-- 5. Action History Table (Phase 4E)
CREATE TABLE IF NOT EXISTS action_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES azure_connections(id) ON DELETE SET NULL,
    vm_name VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL DEFAULT 'DEALLOCATE',
    status VARCHAR(50) NOT NULL,
    dry_run BOOLEAN NOT NULL DEFAULT true,
    cpu_average NUMERIC(5,2),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent column migrations for existing action_history table if present
ALTER TABLE action_history
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES azure_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_history_user_id ON action_history (user_id);
CREATE INDEX IF NOT EXISTS idx_action_history_user_created ON action_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_history_user_conn ON action_history (user_id, connection_id);

-- 6. Persistent Cost Cache Table (Phase 4F / Cost Resilience)
CREATE TABLE IF NOT EXISTS cost_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES azure_connections(id) ON DELETE CASCADE,
    subscription_id VARCHAR(64) NOT NULL,
    cache_type VARCHAR(50) NOT NULL DEFAULT 'MONTH_TO_DATE',
    resource_group VARCHAR(255),
    resource_name VARCHAR(255),
    total_cost NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    cached_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_cache_mtd_unique
ON cost_cache (user_id, connection_id, subscription_id)
WHERE cache_type = 'MONTH_TO_DATE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_cache_resource_unique
ON cost_cache (user_id, connection_id, subscription_id, LOWER(resource_group), LOWER(resource_name))
WHERE cache_type = 'RESOURCE';

