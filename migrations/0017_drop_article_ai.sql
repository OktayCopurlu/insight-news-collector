-- Drop legacy per-article AI artifacts safely (idempotent)

DO $$ BEGIN
  -- Drop optional RPC if it still exists
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.articles_needing_ai()';
  EXCEPTION WHEN undefined_function THEN
    -- Older Postgres may still throw; ignore
    NULL;
  END;
END $$;

-- Drop optional index explicitly (CASCADE from table drop would remove it too)
DO $$ BEGIN
  BEGIN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_article_ai_current';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;

-- Drop the table last (will remove policies/triggers automatically)
DROP TABLE IF EXISTS public.article_ai CASCADE;
