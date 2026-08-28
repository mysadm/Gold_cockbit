-- Real history for Egyptian gold prices, distinct from egypt_price_cache
-- (which only ever holds the single latest fetch, overwritten every call).
-- Global/shared market data, not per-user — mirrors egypt_price_cache having
-- no user_id. One row per calendar day (UTC): repeated fetches on the same
-- day update that day's row rather than piling up duplicates.
CREATE TABLE egypt_price_history (
    id BIGSERIAL PRIMARY KEY,
    rows JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_egypt_price_history_fetched_at ON egypt_price_history (fetched_at);
CREATE UNIQUE INDEX idx_egypt_price_history_one_per_day ON egypt_price_history (((fetched_at AT TIME ZONE 'UTC')::date));
