-- Enable RLS on selected tables (skip missing)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'sources','articles','feeds','categories','article_categories',
    'crawl_log','article_scores','media_assets','article_media','media_variants'
  ])
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '% not found; skipping RLS enable.', t;
    END;
  END LOOP;
END $$;

-- Revoke default public/anon/authenticated grants; RLS policies will govern access
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'sources','articles','feeds','categories','article_categories',
    'crawl_log','article_scores','media_assets','article_media','media_variants'
  ])
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '% not found; skipping grants revoke.', t;
    END;
  END LOOP;
END $$;

-- Optional next step: add role-scoped SELECT policies where needed
-- Example:
-- CREATE POLICY "read articles (auth)" ON public.articles FOR SELECT TO authenticated USING (true);
