CREATE TABLE tranches (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tranche_number SMALLINT NOT NULL CHECK (tranche_number BETWEEN 1 AND 3),
    plan_pct NUMERIC(5, 2) NOT NULL,
    amount_egp NUMERIC(14, 2),
    gram_equivalent NUMERIC(12, 4),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'filled')),
    purchased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tranches_user_id ON tranches (user_id);

CREATE TRIGGER tranches_set_updated_at
    BEFORE UPDATE ON tranches
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
