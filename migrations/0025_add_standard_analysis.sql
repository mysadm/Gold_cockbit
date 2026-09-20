CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shared_analysis_runs (
    id BIGSERIAL PRIMARY KEY,
    slot_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 1,
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE admin_notifications (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- At most one open notification per kind.
CREATE UNIQUE INDEX admin_notifications_one_open
    ON admin_notifications (kind) WHERE resolved_at IS NULL;
