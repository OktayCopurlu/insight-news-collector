-- Optional: Public read for article_ai to mirror media_assets' unrestricted read
DO $$ BEGIN
  -- Ensure RLS is enabled
  BEGIN
    EXECUTE 'ALTER TABLE public.article_ai ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'article_ai not found; skipping RLS enable.';
  END;

  -- Create permissive SELECT policy if it doesn't exist
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'article_ai'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'article_ai'
         AND policyname = 'Public read article_ai'
    ) THEN
      EXECUTE 'CREATE POLICY "Public read article_ai" ON public.article_ai FOR SELECT USING (true)';
    END IF;
  END IF;
END $$;

-- Note: This makes article_ai show as "unrestricted" for reads in Studio.
-- If you prefer auth-only access, drop this policy and create a role-scoped one instead.
