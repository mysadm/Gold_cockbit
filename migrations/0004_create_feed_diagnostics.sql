CREATE TABLE feed_diagnostics (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT REFERENCES price_snapshots(id) ON DELETE CASCADE,
    feed_type TEXT NOT NULL CHECK (feed_type IN ('gold', 'fx')),
    source_name TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    latency_ms INTEGER,
    error_message TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    detail JSONB
);

CREATE INDEX idx_feed_diagnostics_snapshot_id ON feed_diagnostics (snapshot_id);
CREATE INDEX idx_feed_diagnostics_attempted_at ON feed_diagnostics (attempted_at DESC);
