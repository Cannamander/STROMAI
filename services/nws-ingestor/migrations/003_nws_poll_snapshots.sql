-- Lightweight time-series: one row per poll for map overlay, time-window logs, and alerts.
-- At 15-min intervals this is ~96 rows/day.
CREATE TABLE IF NOT EXISTS public.nws_poll_snapshots (
  id                    bigserial PRIMARY KEY,
  polled_at             timestamptz NOT NULL DEFAULT now(),
  duration_ms            int,
  fetched_count         int,
  actionable_count      int,
  geom_present_count    int,
  total_zips_mapped     int,
  impact_inserted       int,
  impact_updated        int,
  lsr_products_fetched  int,
  lsr_entries_parsed    int,
  lsr_entries_with_points int,
  lsr_matches_inserted  int,
  alert_summaries       jsonb
);

CREATE INDEX IF NOT EXISTS idx_nws_poll_snapshots_polled_at ON public.nws_poll_snapshots (polled_at DESC);

COMMENT ON TABLE public.nws_poll_snapshots IS 'One row per ingest poll; use for time-window queries, map overlay history, and alerting.';
