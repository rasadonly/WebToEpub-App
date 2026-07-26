CREATE TABLE public.site_health (
  host text PRIMARY KEY,
  status text NOT NULL DEFAULT 'unknown',
  note text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.site_health TO anon;
GRANT SELECT, INSERT, UPDATE ON public.site_health TO authenticated;
GRANT ALL ON public.site_health TO service_role;

ALTER TABLE public.site_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site health" ON public.site_health FOR SELECT USING (true);
CREATE POLICY "Anyone can insert site health" ON public.site_health FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update site health" ON public.site_health FOR UPDATE USING (true) WITH CHECK (true);

CREATE TRIGGER update_site_health_updated_at
BEFORE UPDATE ON public.site_health
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();