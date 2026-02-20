-- NWS alert → impacted ZIPs (ZCTA intersection). Run once against Supabase Postgres.
CREATE TABLE IF NOT EXISTS public.alert_impacted_zips (
  id           bigserial PRIMARY KEY,
  alert_id     text NOT NULL,
  event        text,
  headline     text,
  severity     text,
  sent         timestamptz,
  effective    timestamptz,
  expires      timestamptz,
  geom_present boolean NOT NULL,
  zips         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_alert_impacted_zips_alert_id UNIQUE (alert_id)
);

COMMENT ON TABLE public.alert_impacted_zips IS 'NWS actionable alerts with derived ZCTA ZIPs via PostGIS intersection with public.zcta5_raw';
