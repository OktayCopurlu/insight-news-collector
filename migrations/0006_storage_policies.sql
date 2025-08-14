-- Ensure media tables have permissive read policies for public endpoints if desired
-- Adjust to your app's security posture.

-- Public read for media_assets via a view (optional). Keep writes restricted.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'Public read media assets'
  ) THEN
    EXECUTE 'CREATE POLICY "Public read media assets" ON public.media_assets FOR SELECT USING (true)';
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- media_assets not present yet; skip
  RAISE NOTICE 'media_assets table not found; skipping policy.';
END $$;

-- Storage note: Buckets manage their own ACL; make the bucket public for thumbnails.
-- Use scripts/verify-storage.js to create bucket and confirm public URL works.
