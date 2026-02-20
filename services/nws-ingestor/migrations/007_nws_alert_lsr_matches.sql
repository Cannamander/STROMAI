-- Matches between alerts (warnings) and LSR observations. Set-based matching; idempotent by (alert_id, observation_id).
CREATE TABLE IF NOT EXISTS public.nws_alert_lsr_matches (
  alert_id        text NOT NULL,
  observation_id  text NOT NULL,
  match_method    text NOT NULL,
  distance_meters numeric,
  match_confidence text NOT NULL,
  matched_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, observation_id),
  CONSTRAINT fk_alert_lsr_match_observation
    FOREIGN KEY (observation_id) REFERENCES public.nws_lsr_observations(observation_id) ON DELETE CASCADE
);

-- Alert side: reference nws_alerts.id (alert_id). If nws_alerts not used for all, we may use alert_impacted_zips.alert_id.
-- We do not add FK to nws_alerts to allow alert_id from alert_impacted_zips; both tables use same alert_id.
CREATE INDEX IF NOT EXISTS idx_nws_alert_lsr_matches_alert_id ON public.nws_alert_lsr_matches (alert_id);
CREATE INDEX IF NOT EXISTS idx_nws_alert_lsr_matches_observation_id ON public.nws_alert_lsr_matches (observation_id);

COMMENT ON TABLE public.nws_alert_lsr_matches IS 'Matches between warning alerts and LSR observations (time + geometry + state).';
