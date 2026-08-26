ALTER TABLE llm_providers DROP CONSTRAINT llm_providers_provider_type_check;
ALTER TABLE llm_providers ADD CONSTRAINT llm_providers_provider_type_check
    CHECK (provider_type IN ('ollama', 'openai', 'claude', 'custom', 'shared', 'openrouter'));
