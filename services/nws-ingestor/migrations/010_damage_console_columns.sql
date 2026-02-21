-- Damage likelihood console: computed columns for operator dashboard (one row per alert_id).
-- alert_class: derived from event string (warning|watch|advisory|statement|other)
-- area_sq_miles: ST_Area(geom::geography)/2589988.11 when geom present (set at ingest)
-- zip_density: zip_count / area_sq_miles when both present
-- geo_method: polygon|zone|county|unknown
-- zip_inference_method: polygon_intersect|none

ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS alert_class text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS area_sq_miles numeric NULL,
  ADD COLUMN IF NOT EXISTS zip_density numeric NULL,
  ADD COLUMN IF NOT EXISTS geo_method text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS zip_inference_method text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.alert_impacted_zips.alert_class IS 'warning|watch|advisory|statement|other from event string';
COMMENT ON COLUMN public.alert_impacted_zips.area_sq_miles IS 'Alert geometry area in sq mi (only when geom present)';
COMMENT ON COLUMN public.alert_impacted_zips.zip_density IS 'zip_count / area_sq_miles when both present';
COMMENT ON COLUMN public.alert_impacted_zips.geo_method IS 'polygon|zone|county|unknown';
COMMENT ON COLUMN public.alert_impacted_zips.zip_inference_method IS 'polygon_intersect|none';

CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_alert_class ON public.alert_impacted_zips (alert_class);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_geom_present ON public.alert_impacted_zips (geom_present);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_zip_count ON public.alert_impacted_zips (zip_count);
