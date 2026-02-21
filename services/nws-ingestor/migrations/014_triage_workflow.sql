-- Operator Trust Layer v1: triage workflow and explainability on alert_impacted_zips.
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS triage_status_source text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS triage_status_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS triage_status_updated_by text NULL,
  ADD COLUMN IF NOT EXISTS triage_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS confidence_level text NOT NULL DEFAULT 'low';

COMMENT ON COLUMN public.alert_impacted_zips.triage_status IS 'new|monitoring|actionable|sent_manual|suppressed';
COMMENT ON COLUMN public.alert_impacted_zips.triage_status_source IS 'system|operator';
COMMENT ON COLUMN public.alert_impacted_zips.triage_reasons IS 'Explainability bullets for UI';
COMMENT ON COLUMN public.alert_impacted_zips.confidence_level IS 'low|medium|high';

CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_triage_status ON public.alert_impacted_zips (triage_status);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_triage_updated_at ON public.alert_impacted_zips (triage_status_updated_at DESC);

-- Audit table for operator triage actions (append-only).
CREATE TABLE IF NOT EXISTS public.nws_triage_audit (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  alert_id text NOT NULL,
  actor text NULL,
  action text NOT NULL,
  prev_status text NOT NULL,
  new_status text NOT NULL,
  note text NULL
);

COMMENT ON TABLE public.nws_triage_audit IS 'Append-only audit log for operator triage actions';
COMMENT ON COLUMN public.nws_triage_audit.action IS 'set_actionable|set_monitoring|set_suppressed|set_sent_manual|reset_to_system';

CREATE INDEX IF NOT EXISTS idx_nws_triage_audit_alert_id ON public.nws_triage_audit (alert_id);
CREATE INDEX IF NOT EXISTS idx_nws_triage_audit_ts ON public.nws_triage_audit (ts DESC);
