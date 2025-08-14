-- Drop permissive public read policies to remove "unrestricted" status in Studio

DO $$ BEGIN
  -- media_assets: drop public read policy if present
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'media_assets'
       AND policyname = 'Public read media assets'
  ) THEN
    EXECUTE 'DROP POLICY "Public read media assets" ON public.media_assets';
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'media_assets not found; skipping policy drop.';
END $$;

DO $$ BEGIN
  -- article_ai: drop public read policy if present
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'article_ai'
       AND policyname = 'Public read article_ai'
  ) THEN
    EXECUTE 'DROP POLICY "Public read article_ai" ON public.article_ai';
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'article_ai not found; skipping policy drop.';
END $$;

-- Ensure RLS remains enabled (service role bypasses RLS for backend access)
DO $$ BEGIN
  BEGIN EXECUTE 'ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY'; EXCEPTION WHEN undefined_table THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.article_ai ENABLE ROW LEVEL SECURITY'; EXCEPTION WHEN undefined_table THEN END;
END $$;

-- Optional: if you later want authenticated-only reads, create scoped policies:
-- CREATE POLICY "Read media (auth)" ON public.media_assets FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Read article_ai (auth)" ON public.article_ai FOR SELECT TO authenticated USING (true);
