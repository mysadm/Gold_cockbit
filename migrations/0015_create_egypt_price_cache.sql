CREATE TABLE egypt_price_cache (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    rows JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL
);
