-- Persist only a one-way hash of the CSRF token alongside the session token hash.
-- Raw session and CSRF tokens must never be stored in the database.
alter table public.levhub_sessions
  add column if not exists csrf_token_hash text;

create index if not exists idx_levhub_sessions_active_expiry
  on public.levhub_sessions (expires_at)
  where revoked_at is null;
