import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const createTablesManually = async () => {
  console.log("Creating database tables manually...");

  const tables = [
    {
      name: "sources",
      sql: `CREATE TABLE IF NOT EXISTS sources (
        id text PRIMARY KEY,
        name text NOT NULL,
        homepage text,
        country char(2),
        lang text,
        terms_url text,
        allowed_use text DEFAULT 'link+snippet',
        canonical_link_required boolean DEFAULT true,
        created_at timestamptz DEFAULT now()
      );`,
    },
    {
      name: "articles",
      sql: `CREATE TABLE IF NOT EXISTS articles (
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
      );`,
    },
    {
      name: "feeds",
      sql: `CREATE TABLE IF NOT EXISTS feeds (
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
      );`,
    },
    {
      name: "categories",
      sql: `CREATE TABLE IF NOT EXISTS categories (
        id serial PRIMARY KEY,
        path text UNIQUE,
        parent_path text
      );`,
    },
    {
      name: "article_categories",
      sql: `CREATE TABLE IF NOT EXISTS article_categories (
        article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
        category_id int REFERENCES categories(id),
        confidence real CHECK (confidence BETWEEN 0 AND 1),
        PRIMARY KEY(article_id, category_id)
      );`,
    },
    {
      name: "crawl_log",
      sql: `CREATE TABLE IF NOT EXISTS crawl_log (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        feed_id uuid REFERENCES feeds(id),
        article_url text,
        status text,
        message text,
        created_at timestamptz DEFAULT now()
      );`,
    },
    {
      name: "article_scores",
      sql: `CREATE TABLE IF NOT EXISTS article_scores (
        article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        score real,
        factors jsonb,
        updated_at timestamptz DEFAULT now()
      );`,
    },
  ];

  // Create each table
  for (const table of tables) {
    try {
      console.log(`Creating ${table.name} table...`);

      // Try using the from() method to execute raw SQL
      const { error } = await supabase.rpc("exec", { sql: table.sql });

      if (error) {
        console.log(`RPC failed for ${table.name}, trying direct query...`);

        // Alternative approach - try to query the table to see if it exists
        const { error: queryError } = await supabase
          .from(table.name)
          .select("*")
          .limit(0);

        if (queryError && queryError.message.includes("does not exist")) {
          console.error(
            `❌ Table ${table.name} does not exist and could not be created`
          );
          console.log(`Please run this SQL manually in Supabase SQL Editor:`);
          console.log(table.sql);
          console.log("---");
        } else {
          console.log(`✓ Table ${table.name} already exists or was created`);
        }
      } else {
        console.log(`✓ Table ${table.name} created successfully`);
      }
    } catch (error) {
      console.error(`Error with ${table.name}:`, error.message);
    }
  }

  // Create indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_articles_source_hash ON articles(source_id, content_hash);",
    "CREATE INDEX IF NOT EXISTS idx_feeds_enabled ON feeds(enabled);",
    "CREATE INDEX IF NOT EXISTS idx_article_categories_cat ON article_categories(category_id);",
  ];

  console.log("Creating indexes...");
  for (const indexSql of indexes) {
    try {
      await supabase.rpc("exec", { sql: indexSql });
    } catch (error) {
      console.log(
        "Index creation failed (this is often normal):",
        error.message
      );
    }
  }

  // Create the RPC function
  // articles_needing_ai RPC removed with legacy per-article AI deprecation

  // Insert seed data
  console.log("Inserting seed data...");
  const seedData = `
    INSERT INTO categories(path, parent_path) VALUES
      ('general', null),
      ('sports', null),
      ('sports.football','sports'),
      ('sports.transfer','sports.football'),
      ('geo', null),
      ('geo.uk','geo'),
      ('geo.uk.london','geo.uk')
    ON CONFLICT (path) DO NOTHING;
  `;

  try {
    await supabase.rpc("exec", { sql: seedData });
    console.log("✓ Seed data inserted");
  } catch (error) {
    console.log("Seed data insertion failed:", error.message);
  }

  console.log("\n🎉 Manual database setup completed!");
  console.log(
    "If any tables failed to create, please run the SQL manually in your Supabase SQL Editor."
  );
};

createTablesManually().catch(console.error);
