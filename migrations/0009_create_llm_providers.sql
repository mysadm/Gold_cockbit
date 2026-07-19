CREATE TABLE llm_providers (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'claude', 'custom')),
    label TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    model TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_providers_user_id ON llm_providers (user_id);
CREATE UNIQUE INDEX idx_llm_providers_one_active_per_user ON llm_providers (user_id) WHERE is_active;

CREATE TRIGGER llm_providers_set_updated_at
    BEFORE UPDATE ON llm_providers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
