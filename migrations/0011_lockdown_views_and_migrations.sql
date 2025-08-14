-- Lock down views and schema_migrations; revoke broad grants; remove "unrestricted" markers in Studio

-- Revoke grants on views that might still appear unrestricted
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT unnest(ARRAY[
    'v_articles_public',
    'v_cluster_reps',
    'v_clusters_needing_ai'
  ])
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'View % not found; skipping revoke.', v;
    END;
  END LOOP;
END $$;

-- Revoke execute on helper function(s)
DO $$
BEGIN
  BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.clusters_needing_ai(text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.clusters_needing_ai(text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.clusters_needing_ai(text) FROM authenticated';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'Function clusters_needing_ai(text) not found; skipping revoke.';
  END;
END $$;

-- Enable RLS and revoke grants on schema_migrations as well
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'schema_migrations not found; skipping RLS enable.';
  END;
  BEGIN
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM authenticated';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'schema_migrations not found; skipping revoke.';
  END;
END $$;
