CREATE TABLE wallet_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    unit TEXT NOT NULL CHECK (unit IN ('oz', 'g24', 'g21', 'g18', 'pounds')),
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    amount NUMERIC(12, 4) NOT NULL CHECK (amount > 0),
    price_egp NUMERIC(14, 2) NOT NULL CHECK (price_egp >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_transactions_user_recorded ON wallet_transactions (user_id, recorded_at);
