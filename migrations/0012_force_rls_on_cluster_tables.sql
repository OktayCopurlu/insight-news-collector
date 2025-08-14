-- Enforce RLS strictly on cluster-related tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clusters','cluster_ai','cluster_updates','schema_migrations'])
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '% not found; skipping.', t;
    END;
  END LOOP;
END $$;
