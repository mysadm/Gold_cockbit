ALTER TABLE dca_plan
    ADD COLUMN tranche_pcts NUMERIC[] NOT NULL DEFAULT '{40,35,25}',
    ADD COLUMN spacing_months INTEGER NOT NULL DEFAULT 2 CHECK (spacing_months > 0),
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'fixed' CHECK (mode IN ('fixed', 'recurring'));
