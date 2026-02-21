-- Persist NWS geo metadata for operator diagnostics (geometry presence, zone counts).
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS affected_zones_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ugc_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.alert_impacted_zips.affected_zones_count IS 'Length of NWS properties.affectedZones';
COMMENT ON COLUMN public.alert_impacted_zips.ugc_count IS 'Length of NWS properties.geocode.UGC';
