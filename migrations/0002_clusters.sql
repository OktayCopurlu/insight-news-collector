-- Cluster schema migration
-- Safe to run multiple times (IF NOT EXISTS guards where possible)

-- Enable trigram for future similarity work
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- clusters table
CREATE TABLE IF NOT EXISTS clusters (
  id text PRIMARY KEY,
  seed_article uuid REFERENCES articles(id) ON DELETE SET NULL,
  rep_article uuid REFERENCES articles(id) ON DELETE SET NULL,
  fingerprint text,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  size int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- cluster_ai table (one current summary per cluster+lang)
CREATE TABLE IF NOT EXISTS cluster_ai (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id text REFERENCES clusters(id) ON DELETE CASCADE,
  lang text,
  ai_title text,
  ai_summary text,
  ai_details text,
  model text,
  created_at timestamptz DEFAULT now(),
  is_current boolean DEFAULT true
);

-- cluster_updates table (timeline)
CREATE TABLE IF NOT EXISTS cluster_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id text REFERENCES clusters(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  happened_at timestamptz,
  stance text,
  claim text,
  evidence text,
  summary text,
  source_id text,
  lang text,
  created_at timestamptz DEFAULT now()
);

-- articles.cluster_id
ALTER TABLE articles ADD COLUMN IF NOT EXISTS cluster_id text;
-- Add FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_articles_cluster'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT fk_articles_cluster
      FOREIGN KEY (cluster_id) REFERENCES clusters(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_ai_current ON cluster_ai(cluster_id, lang) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_cluster_updates_time ON cluster_updates(cluster_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_last_seen ON clusters(last_seen DESC);

-- Enforce one current AI per (cluster, lang)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_cluster_ai_one_current'
  ) THEN
    CREATE UNIQUE INDEX uniq_cluster_ai_one_current
      ON cluster_ai(cluster_id, lang)
      WHERE is_current;
  END IF;
END $$;

-- Representative view: one row per cluster
CREATE OR REPLACE VIEW v_cluster_reps AS
SELECT
  c.id AS cluster_id,
  COALESCE(c.rep_article, a_latest.id) AS rep_article_id,
  c.size,
  c.last_seen,
  c.first_seen
FROM clusters c
LEFT JOIN LATERAL (
  SELECT a.id
  FROM articles a
  WHERE a.cluster_id = c.id
  ORDER BY a.published_at DESC NULLS LAST
  LIMIT 1
) a_latest ON TRUE;
