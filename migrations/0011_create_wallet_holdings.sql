CREATE TABLE wallet_holdings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    oz NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (oz >= 0),
    g24 NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (g24 >= 0),
    g21 NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (g21 >= 0),
    g18 NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (g18 >= 0),
    pounds NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (pounds >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER wallet_holdings_set_updated_at
    BEFORE UPDATE ON wallet_holdings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
