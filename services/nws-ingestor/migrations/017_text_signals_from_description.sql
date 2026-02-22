-- Text-derived signals from NWS description/headline/instruction (used when LSR is 0).
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS text_hail_inches numeric NULL,
  ADD COLUMN IF NOT EXISTS text_wind_mph int NULL,
  ADD COLUMN IF NOT EXISTS text_damage_keywords int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.alert_impacted_zips.text_hail_inches IS 'Hail size (in) parsed from description/headline when LSR is 0';
COMMENT ON COLUMN public.alert_impacted_zips.text_wind_mph IS 'Wind speed (mph) parsed from description/headline when LSR is 0';
COMMENT ON COLUMN public.alert_impacted_zips.text_damage_keywords IS 'Count of damage-related phrases in description/headline';
