-- LSR Hold and Refresh v1: hold state on alert_impacted_zips (operator-facing table).
-- Warnings with geometry but no LSR enter "awaiting" and are rechecked until matched or expired.
ALTER TABLE public.alert_impacted_zips
  ADD COLUMN IF NOT EXISTS lsr_hold_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lsr_last_checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lsr_check_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lsr_status text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.alert_impacted_zips.lsr_hold_until IS 'Hold rechecks until this time (or expires)';
COMMENT ON COLUMN public.alert_impacted_zips.lsr_last_checked_at IS 'Last time LSR matching was run for this alert';
COMMENT ON COLUMN public.alert_impacted_zips.lsr_check_attempts IS 'Number of LSR recheck attempts';
COMMENT ON COLUMN public.alert_impacted_zips.lsr_status IS 'none|awaiting|matched|expired';

-- Ensure default for existing rows
UPDATE public.alert_impacted_zips SET lsr_status = 'none' WHERE lsr_status IS NULL OR lsr_status = '';

CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_lsr_status ON public.alert_impacted_zips (lsr_status);
CREATE INDEX IF NOT EXISTS idx_alert_impacted_zips_lsr_last_checked_at ON public.alert_impacted_zips (lsr_last_checked_at);
