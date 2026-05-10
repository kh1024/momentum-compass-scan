CREATE TABLE public.scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  picks_input jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping_steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_picks jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limited boolean NOT NULL DEFAULT false,
  live_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scan_runs_started_at ON public.scan_runs (started_at DESC);

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;

-- Read-only public access for the debug UI; writes only via service role.
CREATE POLICY "Scan runs are publicly readable"
  ON public.scan_runs FOR SELECT
  USING (true);
