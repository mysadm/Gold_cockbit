CREATE TABLE dca_plan (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    total_investment_egp NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_investment_egp >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER dca_plan_set_updated_at
    BEFORE UPDATE ON dca_plan
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
