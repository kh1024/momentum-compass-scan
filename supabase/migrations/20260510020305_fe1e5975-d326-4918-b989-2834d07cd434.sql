CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE INDEX IF NOT EXISTS idx_massive_quote_cache_expires_at
  ON public.massive_quote_cache (expires_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-massive-quote-cache') THEN
    PERFORM cron.unschedule('purge-massive-quote-cache');
  END IF;
END $$;

SELECT cron.schedule(
  'purge-massive-quote-cache',
  '*/15 * * * *',
  $$DELETE FROM public.massive_quote_cache WHERE expires_at < now();$$
);