ALTER TABLE llm_providers ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
