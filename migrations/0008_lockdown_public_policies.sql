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
  -- previously dropped legacy per-article AI public policy; table removed so no-op
  NULL;
END $$;

-- Ensure RLS remains enabled (service role bypasses RLS for backend access)
DO $$ BEGIN
  BEGIN EXECUTE 'ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY'; EXCEPTION WHEN undefined_table THEN END;
END $$;

-- Optional: if you later want authenticated-only reads, create scoped policies:
-- CREATE POLICY "Read media (auth)" ON public.media_assets FOR SELECT TO authenticated USING (true);
-- legacy per-article AI removed; no policy needed
