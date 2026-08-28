-- Real history for the international gold price and USD/EGP rate. Unlike
-- Egypt prices, these are currently fetched entirely client-side (see
-- pullLive() in src/App.tsx, across several free keyless feeds with
-- failover) — the server never sees them today, so there's nothing to
-- migrate off of. The client records a snapshot here after each successful
-- pull. Global/shared market data, not per-user. One row per calendar day
-- (UTC), same convention as wallet_snapshots and egypt_price_history.
CREATE TABLE international_price_history (
    id BIGSERIAL PRIMARY KEY,
    spot_usd NUMERIC(14, 2) NOT NULL,
    usd_egp NUMERIC(10, 4),
    gold_source TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_international_price_history_fetched_at ON international_price_history (fetched_at);
CREATE UNIQUE INDEX idx_international_price_history_one_per_day ON international_price_history (((fetched_at AT TIME ZONE 'UTC')::date));
