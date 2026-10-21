ALTER TABLE canvas_generations ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE canvas_generations ADD COLUMN IF NOT EXISTS provider_client_request_id TEXT;
