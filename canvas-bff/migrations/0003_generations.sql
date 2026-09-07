CREATE TABLE IF NOT EXISTS canvas_generations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES canvas_accounts(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES canvas_providers(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_request_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    provider_task_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    error_code TEXT,
    output_asset_id TEXT REFERENCES canvas_assets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS canvas_generations_claim_idx ON canvas_generations (status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS canvas_generations_account_id_idx ON canvas_generations (account_id, created_at DESC);
