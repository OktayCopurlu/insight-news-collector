import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const createTables = async () => {
  console.log("Creating database tables...");

  try {
    // Create sources table
    const { error: sourcesError } = await supabase.rpc("exec_sql", {
      sql: `
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
        ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (sourcesError) {
      console.error("Error creating sources table:", sourcesError);
    } else {
      console.log("✓ Sources table created");
    }

    // Create articles table
    const { error: articlesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS articles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          source_id text REFERENCES sources(id),
          url text NOT NULL,
          canonical_url text,
          title text,
          snippet text,
          full_text text, -- added to persist extracted full article body
          language text,
          published_at timestamptz,
          fetched_at timestamptz DEFAULT now(),
          content_hash text,
          cluster_id text,
          UNIQUE (source_id, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_articles_source_hash ON articles(source_id, content_hash);
        ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
        -- Ensure column present if table pre-existed without it
        ALTER TABLE articles ADD COLUMN IF NOT EXISTS full_text text;
      `,
    });

    if (articlesError) {
      console.error("Error creating articles table:", articlesError);
    } else {
      console.log("✓ Articles table created");
    }

    // Create article_ai table
    const { error: aiError } = await supabase.rpc("exec_sql", {
      sql: `
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
        CREATE INDEX IF NOT EXISTS idx_article_ai_current ON article_ai(article_id, is_current);
        ALTER TABLE article_ai ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (aiError) {
      console.error("Error creating article_ai table:", aiError);
    } else {
      console.log("✓ Article AI table created");
    }

    // Create feeds table
    const { error: feedsError } = await supabase.rpc("exec_sql", {
      sql: `
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
        CREATE INDEX IF NOT EXISTS idx_feeds_enabled ON feeds(enabled);
        ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (feedsError) {
      console.error("Error creating feeds table:", feedsError);
    } else {
      console.log("✓ Feeds table created");
    }

    // Create categories table
    const { error: categoriesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS categories (
          id serial PRIMARY KEY,
          path text UNIQUE,
          parent_path text
        );
        ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (categoriesError) {
      console.error("Error creating categories table:", categoriesError);
    } else {
      console.log("✓ Categories table created");
    }

    // Create article_categories table
    const { error: articleCategoriesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS article_categories (
          article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
          category_id int REFERENCES categories(id),
          confidence real CHECK (confidence BETWEEN 0 AND 1),
          PRIMARY KEY(article_id, category_id)
        );
        CREATE INDEX IF NOT EXISTS idx_article_categories_cat ON article_categories(category_id);
        ALTER TABLE article_categories ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (articleCategoriesError) {
      console.error(
        "Error creating article_categories table:",
        articleCategoriesError
      );
    } else {
      console.log("✓ Article categories table created");
    }

    // Create crawl_log table
    const { error: crawlLogError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS crawl_log (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          feed_id uuid REFERENCES feeds(id),
          article_url text,
          status text,
          message text,
          created_at timestamptz DEFAULT now()
        );
        ALTER TABLE crawl_log ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (crawlLogError) {
      console.error("Error creating crawl_log table:", crawlLogError);
    } else {
      console.log("✓ Crawl log table created");
    }

    // Create article_scores table
    const { error: scoresError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS article_scores (
          article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
          score real,
          factors jsonb,
          updated_at timestamptz DEFAULT now()
        );
        ALTER TABLE article_scores ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (scoresError) {
      console.error("Error creating article_scores table:", scoresError);
    } else {
      console.log("✓ Article scores table created");
    }

    // Create the RPC function for articles needing AI
    const { error: rpcError } = await supabase.rpc("exec_sql", {
      sql: `
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
      `,
    });

    if (rpcError) {
      console.error("Error creating RPC function:", rpcError);
    } else {
      console.log("✓ RPC function created");
    }

    // Insert seed data
    const { error: seedError } = await supabase.rpc("exec_sql", {
      sql: `
        INSERT INTO categories(path, parent_path) VALUES
          ('general', null),
          ('sports', null),
          ('sports.football','sports'),
          ('sports.transfer','sports.football'),
          ('geo', null),
          ('geo.uk','geo'),
          ('geo.uk.london','geo.uk')
        ON CONFLICT (path) DO NOTHING;
      `,
    });

    if (seedError) {
      console.error("Error inserting seed data:", seedError);
    } else {
      console.log("✓ Seed data inserted");
    }

    console.log("\n🎉 Database tables created successfully!");
  } catch (error) {
    console.error("Failed to create tables:", error);
    process.exit(1);
  }
};

createTables();
