ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    ADD COLUMN daily_ai_limit INTEGER NOT NULL DEFAULT 3 CHECK (daily_ai_limit >= 0);

-- Users that exist before this migration (the single default user) keep
-- working; scripts/create-admin.mjs converts that user into the admin.
UPDATE users SET status = 'active';

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
