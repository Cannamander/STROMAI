-- ZCTA centroid points (WGS84) for map ZIP coverage proxy. Populated from zcta5_raw.
-- Run after zcta5_raw is loaded. Safe to re-run (truncate + re-insert).
CREATE TABLE IF NOT EXISTS public.zcta5_centroids (
  zcta5ce20 text PRIMARY KEY,
  geom geometry(Point, 4326) NOT NULL
);

COMMENT ON TABLE public.zcta5_centroids IS 'ZCTA centroid points in WGS84 for map display; derived from zcta5_raw via ST_PointOnSurface + ST_Transform to 4326';

CREATE INDEX IF NOT EXISTS idx_zcta5_centroids_geom ON public.zcta5_centroids USING GIST (geom);

-- Populate from zcta5_raw (SRID 4269). Use ST_PointOnSurface so centroid is inside polygon.
INSERT INTO public.zcta5_centroids (zcta5ce20, geom)
SELECT z.zcta5ce20, ST_Transform(ST_PointOnSurface(z.geom), 4326)::geometry(Point, 4326)
FROM public.zcta5_raw z
WHERE z.zcta5ce20 IS NOT NULL AND z.geom IS NOT NULL
ON CONFLICT (zcta5ce20) DO UPDATE SET geom = EXCLUDED.geom;
