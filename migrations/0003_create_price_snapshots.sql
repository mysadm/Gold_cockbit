CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL,
    xau_usd NUMERIC(12, 4) NOT NULL,
    usd_egp NUMERIC(12, 4) NOT NULL,
    gram_24k_egp NUMERIC(12, 4) NOT NULL,
    gram_22k_egp NUMERIC(12, 4) NOT NULL,
    gram_21k_egp NUMERIC(12, 4) NOT NULL,
    gram_18k_egp NUMERIC(12, 4) NOT NULL,
    gold_pound_egp NUMERIC(12, 4) NOT NULL,
    souq_dollar_egp NUMERIC(12, 4),
    souq_spread_pct NUMERIC(8, 4),
    calibration_premium_pct NUMERIC(8, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_snapshots_fetched_at ON price_snapshots (fetched_at DESC);
