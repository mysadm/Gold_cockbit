CREATE TABLE scenarios (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    band_low NUMERIC(12, 4),
    band_high NUMERIC(12, 4),
    weight_pct NUMERIC(5, 2) NOT NULL CHECK (weight_pct BETWEEN 0 AND 100),
    probability_pct NUMERIC(5, 2),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_user_id ON scenarios (user_id);

CREATE TRIGGER scenarios_set_updated_at
    BEFORE UPDATE ON scenarios
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
