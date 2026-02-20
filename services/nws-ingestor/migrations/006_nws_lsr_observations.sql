-- LSR observations: parsed from NWS LSR products. Idempotent upsert by observation_id.
CREATE TABLE IF NOT EXISTS public.nws_lsr_observations (
  observation_id    text PRIMARY KEY,
  product_id        text NOT NULL,
  issued_at         timestamptz,
  wfo               text,
  event_type        text NOT NULL,
  occurred_at       timestamptz,
  state             text,
  county            text,
  place             text,
  hail_inches       numeric,
  wind_mph          int,
  rain_inches       numeric,
  temp_f            int,
  geom              geometry(Point, 4326),
  raw_line_text     text,
  occurred_time_confidence text
);

CREATE INDEX IF NOT EXISTS idx_nws_lsr_observations_occurred_at ON public.nws_lsr_observations (occurred_at);
CREATE INDEX IF NOT EXISTS idx_nws_lsr_observations_state ON public.nws_lsr_observations (state);
CREATE INDEX IF NOT EXISTS idx_nws_lsr_observations_geom ON public.nws_lsr_observations USING GIST (geom);

COMMENT ON TABLE public.nws_lsr_observations IS 'Parsed LSR observations from NWS products; matched to warnings via nws_alert_lsr_matches';
