CREATE TABLE wallet_snapshots (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intl_value_egp NUMERIC(14, 2) NOT NULL,
    egypt_value_egp NUMERIC(14, 2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_snapshots_user_recorded ON wallet_snapshots (user_id, recorded_at);
CREATE UNIQUE INDEX idx_wallet_snapshots_one_per_day ON wallet_snapshots (user_id, ((recorded_at AT TIME ZONE 'UTC')::date));
