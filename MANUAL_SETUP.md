# Manual Database Setup Instructions

The automated table creation scripts are not working with your Supabase setup. Please follow these steps to create the database tables manually:

## Step 1: Open Supabase SQL Editor

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Click on "SQL Editor" in the left sidebar
4. Click "New query"

## Step 2: Copy and paste this SQL

```sql
-- Create sources table
CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  homepage text,
  country char(2),
  lang text,
  terms_url text,
  allowed_use text DEFAULT 'link+snippet',
  canonical_link_required boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create articles table
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text REFERENCES sources(id),
  url text NOT NULL,
  canonical_url text,
  title text,
  snippet text,
  language text,
  published_at timestamptz,
  fetched_at timestamptz DEFAULT now(),
  content_hash text,
  cluster_id text,
  UNIQUE (source_id, content_hash)
);

-- Create feeds table
CREATE TABLE IF NOT EXISTS feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text REFERENCES sources(id),
  url text NOT NULL,
  kind text CHECK (kind IN ('rss','atom','api')) NOT NULL,
  country char(2),
  lang text,
  section text,
  schedule_cron text DEFAULT '*/5 * * * *',
  enabled boolean DEFAULT true,
  last_etag text,
  last_modified text,
  last_seen_at timestamptz
);

-- Create article_ai table
CREATE TABLE IF NOT EXISTS article_ai (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  ai_title text,
  ai_summary text,
  ai_details text,
  ai_language text,
  model text,
  prompt_hash text,
  created_at timestamptz DEFAULT now(),
  is_current boolean DEFAULT true
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id serial PRIMARY KEY,
  path text UNIQUE,
  parent_path text
);

-- Create article_categories table
CREATE TABLE IF NOT EXISTS article_categories (
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  category_id int REFERENCES categories(id),
  confidence real CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY(article_id, category_id)
);

-- Create crawl_log table
CREATE TABLE IF NOT EXISTS crawl_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_id uuid REFERENCES feeds(id),
  article_url text,
  status text,
  message text,
  created_at timestamptz DEFAULT now()
);

-- Create article_scores table
CREATE TABLE IF NOT EXISTS article_scores (
  article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  score real,
  factors jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_hash ON articles(source_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_article_ai_current ON article_ai(article_id, is_current);
CREATE INDEX IF NOT EXISTS idx_feeds_enabled ON feeds(enabled);
CREATE INDEX IF NOT EXISTS idx_article_categories_cat ON article_categories(category_id);

-- Enable Row Level Security
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_ai ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_scores ENABLE ROW LEVEL SECURITY;

-- Create RPC function
CREATE OR REPLACE FUNCTION articles_needing_ai()
RETURNS TABLE (
  id uuid,
  published_at timestamptz,
  language text,
  source_trust real,
  cluster_size int
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.published_at, a.language,
         0.7::real as source_trust,
         1 as cluster_size
    FROM articles a
   WHERE NOT EXISTS (SELECT 1 FROM article_ai x WHERE x.article_id=a.id AND x.is_current)
   ORDER BY a.published_at DESC NULLS LAST
   LIMIT 200;
END; $$;

-- Insert seed data
INSERT INTO categories(path, parent_path) VALUES
  ('general', null),
  ('sports', null),
  ('sports.football','sports'),
  ('sports.transfer','sports.football'),
  ('geo', null),
  ('geo.uk','geo'),
  ('geo.uk.london','geo.uk')
ON CONFLICT (path) DO NOTHING;
```

## Step 3: Run the SQL

1. Click the "Run" button (or press Ctrl+Enter)
2. Wait for it to complete
3. You should see "Success. No rows returned" or similar

## Step 4: Restart your server

After running the SQL, restart your Node.js server and the errors should be gone.

## Verification

You can verify the tables were created by running this query:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see all the tables listed: articles, article_ai, article_categories, article_scores, categories, crawl_log, feeds, sources.