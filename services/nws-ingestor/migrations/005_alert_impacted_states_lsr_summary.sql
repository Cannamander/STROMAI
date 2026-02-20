-- Add impacted_states, zip_count, and LSR summary columns to alert_impacted_zips.
-- All alerts get states/zips; only warnings get LSR enrichment summary.
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS impacted_states text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS zip_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lsr_match_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hail_max_inches numeric,
  ADD COLUMN IF NOT EXISTS wind_max_mph int,
  ADD COLUMN IF NOT EXISTS tornado_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flood_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_keyword_hits int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lsr_top_tokens text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.alert_impacted_zips.impacted_states IS 'State codes from geocode UGC (first 2 chars of each zone)';
COMMENT ON COLUMN public.alert_impacted_zips.zip_count IS 'Cardinality of zips (impacted_zips)';
COMMENT ON COLUMN public.alert_impacted_zips.lsr_match_count IS 'Number of LSR observations matched (warnings only)';
COMMENT ON COLUMN public.alert_impacted_zips.hail_max_inches IS 'Max hail from matched LSRs';
COMMENT ON COLUMN public.alert_impacted_zips.wind_max_mph IS 'Max wind from matched LSRs';
COMMENT ON COLUMN public.alert_impacted_zips.tornado_count IS 'Count of TORNADO event_type in matched LSRs';
COMMENT ON COLUMN public.alert_impacted_zips.flood_count IS 'Count of FLASH_FLOOD + HEAVY_RAIN in matched LSRs';
COMMENT ON COLUMN public.alert_impacted_zips.damage_keyword_hits IS 'Matches of damage keywords in raw_line_text';
COMMENT ON COLUMN public.alert_impacted_zips.lsr_top_tokens IS 'Up to 3 short normalized phrases from matched observations';
