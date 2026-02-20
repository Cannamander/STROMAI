-- LSR (Local Storm Reports) enrichment: ground-truth observations matched to NWS alerts.
CREATE TABLE IF NOT EXISTS public.nws_alert_lsr (
  id              bigserial PRIMARY KEY,
  alert_id        text NOT NULL,
  lsr_product_id  text NOT NULL,
  entry_time      timestamptz,
  point_geom      geometry(Point, 4326),
  hail_in         numeric,
  wind_gust_mph   int,
  raw_text        text,
  raw_text_hash   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nws_alert_lsr_alert_id ON public.nws_alert_lsr (alert_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nws_alert_lsr_dedupe
  ON public.nws_alert_lsr (alert_id, lsr_product_id, COALESCE(entry_time, '-infinity'::timestamptz), raw_text_hash);

COMMENT ON TABLE public.nws_alert_lsr IS 'LSR entries matched to NWS alerts (point-in-polygon, time window).';
