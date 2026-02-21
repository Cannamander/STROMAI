-- Single row: timestamp of the last "run ingest once" start. Used to filter dashboard to only show alerts from that run (testing).
CREATE TABLE IF NOT EXISTS public.last_ingest_run (
  id int PRIMARY KEY DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.last_ingest_run (id, updated_at) VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.last_ingest_run IS 'Updated at start of each POST /v1/ingest/once; dashboard can filter to last_seen_at >= this for testing';
