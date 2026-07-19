CREATE TABLE alert_rules (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('band_edge', 'egp_move', 'tranche_window')),
    config JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_user_id ON alert_rules (user_id);

CREATE TRIGGER alert_rules_set_updated_at
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
