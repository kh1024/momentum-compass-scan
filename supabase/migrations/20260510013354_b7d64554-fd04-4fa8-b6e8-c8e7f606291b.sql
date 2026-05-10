create table if not exists public.massive_quote_cache (
  symbol text primary key,
  value jsonb,                       -- MassiveQuote JSON, or null for "no result"
  expires_at timestamptz not null,
  cached_at timestamptz not null default now()
);

create index if not exists massive_quote_cache_expires_at_idx
  on public.massive_quote_cache (expires_at);

alter table public.massive_quote_cache enable row level security;
-- No policies = service role only. Browser clients have no access.