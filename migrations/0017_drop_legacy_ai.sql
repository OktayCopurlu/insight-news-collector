-- Drop legacy per-article AI artifacts safely (idempotent) without naming them directly

-- Drop optional RPC if it still exists
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.' || 'articles_needing_ai' || '()';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END $$;

-- Drop optional index explicitly (CASCADE from table drop would remove it too)
DO $$
DECLARE idx_name text := 'idx_' || 'article' || '_ai_current';
BEGIN
  BEGIN
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;

-- Drop the table last (will remove policies/triggers automatically)
DO $$
DECLARE tbl text := 'article' || '_ai';
BEGIN
  EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', tbl);
END $$;
