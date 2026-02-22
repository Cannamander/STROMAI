-- Client Territories and Client Views: clients, territories, thresholds, operator prefs.
CREATE TABLE IF NOT EXISTS public.clients (
  client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.clients IS 'Operator-managed clients for scoped views';
COMMENT ON COLUMN public.clients.client_id IS 'Primary key';
COMMENT ON COLUMN public.clients.name IS 'Display name';
COMMENT ON COLUMN public.clients.is_active IS 'When false, hidden from selector';

CREATE TABLE IF NOT EXISTS public.client_territories (
  client_id uuid PRIMARY KEY REFERENCES public.clients(client_id) ON DELETE CASCADE,
  states text[] NOT NULL DEFAULT '{}',
  zip_allowlist text[] NULL,
  zip_blocklist text[] NULL,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.client_territories IS 'Operating area per client: states (and optional ZIP lists)';
COMMENT ON COLUMN public.client_territories.states IS 'State codes (e.g. TX, OK)';

CREATE TABLE IF NOT EXISTS public.client_thresholds (
  client_id uuid PRIMARY KEY REFERENCES public.clients(client_id) ON DELETE CASCADE,
  hail_min_inches numeric NOT NULL DEFAULT 1.25,
  wind_min_mph int NOT NULL DEFAULT 70,
  rare_freeze_enabled boolean NOT NULL DEFAULT true,
  rare_freeze_states text[] NOT NULL DEFAULT ARRAY['TX']::text[],
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.client_thresholds IS 'Per-client thresholds for interesting flags and badges';
COMMENT ON COLUMN public.client_thresholds.rare_freeze_states IS 'States where freeze is considered rare (v1: TX only)';

CREATE TABLE IF NOT EXISTS public.operator_prefs (
  actor text PRIMARY KEY,
  default_client_id uuid NULL REFERENCES public.clients(client_id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.operator_prefs IS 'Operator UI preferences (e.g. default client)';

-- Ensure every client has territory and thresholds rows (created on client insert or via PUT config).
-- We create them on first config access; no trigger required for v1.
