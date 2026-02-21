-- Threshold flags, delivery tracking, and damage_score on alert_impacted_zips.
-- Persisted per alert for operator UI and API.
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS certainty text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS interesting_hail boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interesting_wind boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interesting_rare_freeze boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interesting_any boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_last_error text,
  ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS damage_score int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.alert_impacted_zips.urgency IS 'NWS urgency';
COMMENT ON COLUMN public.alert_impacted_zips.certainty IS 'NWS certainty';
COMMENT ON COLUMN public.alert_impacted_zips.last_seen_at IS 'Last time this alert was seen in ingest';
COMMENT ON COLUMN public.alert_impacted_zips.interesting_hail IS 'hail_max_inches >= threshold (e.g. 1.25)';
COMMENT ON COLUMN public.alert_impacted_zips.interesting_wind IS 'wind_max_mph >= threshold (e.g. 70)';
COMMENT ON COLUMN public.alert_impacted_zips.interesting_rare_freeze IS 'Freeze event + state in FREEZE_RARE_STATES';
COMMENT ON COLUMN public.alert_impacted_zips.interesting_any IS 'OR of interesting_hail, interesting_wind, interesting_rare_freeze';
COMMENT ON COLUMN public.alert_impacted_zips.delivery_status IS 'pending|sent|failed|suppressed';
COMMENT ON COLUMN public.alert_impacted_zips.delivery_attempts IS 'Number of delivery attempts';
COMMENT ON COLUMN public.alert_impacted_zips.delivery_last_error IS 'Last delivery error message';
COMMENT ON COLUMN public.alert_impacted_zips.delivery_last_attempt_at IS 'Last delivery attempt timestamp';
COMMENT ON COLUMN public.alert_impacted_zips.damage_score IS '0-100 explainable score';

CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_damage_score ON public.alert_impacted_zips (damage_score DESC);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_interesting_any ON public.alert_impacted_zips (interesting_any) WHERE interesting_any = true;
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_delivery_status ON public.alert_impacted_zips (delivery_status);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_expires ON public.alert_impacted_zips (expires);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_last_seen_at ON public.alert_impacted_zips (last_seen_at DESC);
