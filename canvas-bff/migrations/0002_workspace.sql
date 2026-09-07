CREATE TABLE IF NOT EXISTS canvas_providers (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES canvas_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    model TEXT,
    group_name TEXT,
    channel TEXT,
    sub2api_key_id TEXT,
    secret_ciphertext TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    secret_auth_tag TEXT NOT NULL,
    secret_key_version TEXT NOT NULL,
    secret_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS canvas_providers_account_id_idx ON canvas_providers (account_id);

CREATE TABLE IF NOT EXISTS canvas_projects (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES canvas_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS canvas_projects_account_id_idx ON canvas_projects (account_id);

CREATE TABLE IF NOT EXISTS canvas_assets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES canvas_accounts(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES canvas_projects(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    object_key TEXT,
    provider_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS canvas_assets_account_id_idx ON canvas_assets (account_id);
CREATE INDEX IF NOT EXISTS canvas_assets_project_id_idx ON canvas_assets (project_id);
