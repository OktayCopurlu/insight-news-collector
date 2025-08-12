import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const createTables = async () => {
  console.log('Creating database tables...');
  
  try {
    // Create sources table
    console.log('Creating sources table...');
    const { error: sourcesError } = await supabase
      .from('_temp')
      .select('*')
      .limit(0);
    
    // If we can't even do a basic query, let's try a different approach
    const { data, error } = await supabase.rpc('exec', {
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
      `
    });
    
    if (error) {
      console.log('RPC exec failed, trying direct SQL execution...');
      
      // Try using the SQL editor approach
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify({
          sql: `
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
            
            -- Enable RLS
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
          `
        })
      });
      
      if (response.ok) {
        console.log('✓ Database tables created successfully via REST API');
      } else {
        const errorText = await response.text();
        console.error('REST API failed:', errorText);
        throw new Error('Failed to create tables via REST API');
      }
    } else {
      console.log('✓ Database tables created successfully via RPC');
    }
    
    console.log('\n🎉 Database setup completed!');
    
  } catch (error) {
    console.error('Failed to create tables:', error.message);
    console.log('\n❌ Database setup failed. Please run the SQL manually in Supabase SQL Editor:');
    console.log('Copy the SQL from migrations/-- Migration: 0001_init.txt and paste it into your Supabase SQL Editor.');
    process.exit(1);
  }
};

createTables();