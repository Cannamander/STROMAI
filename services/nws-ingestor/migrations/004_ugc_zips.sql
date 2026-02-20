-- Lookup: NWS UGC code → list of ZCTA ZIPs. Used when alert has no geometry but has zone (UGC) from NWS.
-- Populate from Census county–ZCTA data or from NWS zone/county boundaries intersected with ZCTA.
-- UGC format: 6 chars e.g. NJC017 (state NJ, type C=county, number 017). One row per UGC.
CREATE TABLE IF NOT EXISTS public.ugc_zips (
  ugc   text PRIMARY KEY,
  zips  text[] NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE public.ugc_zips IS 'UGC (e.g. NJC017) to ZCTA ZIP list for ZIP inference when NWS alert has no geometry';
COMMENT ON COLUMN public.ugc_zips.ugc IS 'NWS Universal Geographic Code, 6 chars (e.g. NJC017, NYZ007)';
COMMENT ON COLUMN public.ugc_zips.zips IS 'ZIP (ZCTA) codes that fall in this UGC zone';
