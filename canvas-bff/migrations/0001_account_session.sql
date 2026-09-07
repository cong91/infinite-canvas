CREATE TABLE IF NOT EXISTS canvas_accounts (
    id TEXT PRIMARY KEY,
    sub2api_user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS canvas_sessions (
    session_hash CHAR(64) PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES canvas_accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS canvas_sessions_account_id_idx ON canvas_sessions (account_id);
CREATE INDEX IF NOT EXISTS canvas_sessions_expires_at_idx ON canvas_sessions (expires_at);
