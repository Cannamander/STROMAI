-- Delivery outbox for downstream integration (e.g. property enrichment). Idempotent by event_key.
CREATE TABLE IF NOT EXISTS public.zip_delivery_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'queued',
  destination       text NOT NULL,
  event_key         text NOT NULL UNIQUE,
  alert_id          text NOT NULL,
  payload_version   int NOT NULL DEFAULT 1,
  payload           jsonb NOT NULL,
  attempt_count     int NOT NULL DEFAULT 0,
  last_error        text,
  last_attempt_at   timestamptz,
  remote_job_id     text
);

COMMENT ON TABLE public.zip_delivery_outbox IS 'Outbox for ZIP/delivery payloads; idempotent by event_key';
COMMENT ON COLUMN public.zip_delivery_outbox.status IS 'queued|sending|sent|failed|cancelled';
COMMENT ON COLUMN public.zip_delivery_outbox.destination IS 'e.g. property_enrichment_v1, manual_entry';
COMMENT ON COLUMN public.zip_delivery_outbox.event_key IS 'Idempotency key: alert_id + payload_version + zip_hash';
COMMENT ON COLUMN public.zip_delivery_outbox.alert_id IS 'References alert_impacted_zips.alert_id';

CREATE INDEX IF NOT EXISTS idx_zip_delivery_outbox_status ON public.zip_delivery_outbox (status);
CREATE INDEX IF NOT EXISTS idx_zip_delivery_outbox_created_at ON public.zip_delivery_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zip_delivery_outbox_alert_id ON public.zip_delivery_outbox (alert_id);
