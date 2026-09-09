ALTER TABLE canvas_providers ADD COLUMN IF NOT EXISTS secret_masked TEXT NOT NULL DEFAULT '****';
