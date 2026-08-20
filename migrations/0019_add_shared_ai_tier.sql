ALTER TABLE llm_providers DROP CONSTRAINT llm_providers_provider_type_check;
ALTER TABLE llm_providers ADD CONSTRAINT llm_providers_provider_type_check
    CHECK (provider_type IN ('ollama', 'openai', 'claude', 'custom', 'shared'));

CREATE TABLE ai_shared_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_on DATE NOT NULL DEFAULT CURRENT_DATE,
    call_count INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, used_on)
);

CREATE TRIGGER ai_shared_usage_set_updated_at
    BEFORE UPDATE ON ai_shared_usage
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
