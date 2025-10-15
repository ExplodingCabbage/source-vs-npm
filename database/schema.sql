-- Needs executing with the `psql` CLI

CREATE DATABASE source_vs_npm;

\connect source_vs_npm;

CREATE TABLE audit_job (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    args TEXT[] NOT NULL
);

-- TODO: Add primary key and/or unique constraint
CREATE TABLE package_audit (
    audit_run_id INTEGER NOT NULL REFERENCES audit_job(id),
    package_name TEXT NOT NULL,
    package_version TEXT, -- Nullable for cases where registry fetch fails
    results JSONB NOT NULL
);
