-- Similarity (trigram) support for clustering
-- Safe to run multiple times

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Composite search text for articles: title + first 2000 chars of full_text
-- Index to accelerate similarity lookups
CREATE INDEX IF NOT EXISTS idx_articles_search_trgm
  ON articles USING gin (
    (lower(coalesce(title,'') || ' ' || substr(coalesce(full_text,''),1,2000))) gin_trgm_ops
  );

-- Helper function: find similar recent articles using trigram similarity
-- Returns candidates with their similarity score and cluster_id (if any)
CREATE OR REPLACE FUNCTION find_similar_articles(
  p_title text,
  p_full_text text DEFAULT NULL,
  p_window_hours int DEFAULT 72,
  p_threshold real DEFAULT 0.4,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  article_id uuid,
  similarity real,
  cluster_id text
)
LANGUAGE plpgsql AS $$
DECLARE
  q_text text;
BEGIN
  q_text := lower(coalesce(p_title,'') || ' ' || substr(coalesce(p_full_text,''),1,2000));

  RETURN QUERY
  SELECT * FROM (
    SELECT a.id,
           similarity(lower(coalesce(a.title,'') || ' ' || substr(coalesce(a.full_text,''),1,2000)), q_text) AS similarity,
           a.cluster_id
    FROM articles a
    WHERE a.published_at >= now() - make_interval(hours => p_window_hours)
      AND (lower(coalesce(a.title,'') || ' ' || substr(coalesce(a.full_text,''),1,2000))) % q_text
  ) s
  WHERE s.similarity >= p_threshold
  ORDER BY s.similarity DESC
  LIMIT p_limit;
END;
$$;
