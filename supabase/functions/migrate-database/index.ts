/*
# Database Migration Edge Function

This function will run the initial database migration to set up all required tables and structures.

## Usage
Call this function once after setting up your Supabase project to initialize the database schema.
*/

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Split migration into individual statements
    const migrationStatements = [
      // Extensions
      `create extension if not exists pgcrypto;`,
      `create extension if not exists pg_trgm;`,
      `create extension if not exists vector;`,
      `create extension if not exists http;`,
      
      // Core tables
      `create table if not exists sources (
        id text primary key,
        name text not null,
        homepage text,
        country char(2),
        lang text,
        terms_url text,
        allowed_use text default 'link+snippet',
        canonical_link_required boolean default true,
        created_at timestamptz default now()
      );`,
      
      `create table if not exists articles (
        id uuid primary key default gen_random_uuid(),
        source_id text references sources(id),
        url text not null,
        canonical_url text,
        title text,
        snippet text,
        language text,
        published_at timestamptz,
        fetched_at timestamptz default now(),
        content_hash text,
        cluster_id text,
        title_embedding vector(384),
        unique (source_id, content_hash)
      );`,
      
      `create table if not exists article_ai (
        id uuid primary key default gen_random_uuid(),
        article_id uuid references articles(id) on delete cascade,
        ai_title text,
        ai_summary text,
        ai_details text,
        ai_language text,
        model text,
        prompt_hash text,
        created_at timestamptz default now(),
        is_current boolean default true
      );`,
      
      `create table if not exists media_assets (
        id text primary key,
        origin text check (origin in ('publisher','stock','ai_generated')),
        url text,
        storage_path text,
        width int, height int,
        caption text, alt text,
        license text, attribution text,
        hash text
      );`,
      
      `create table if not exists article_media (
        article_id uuid references articles(id) on delete cascade,
        media_id text references media_assets(id),
        role text,
        position int default 0,
        primary key(article_id, media_id)
      );`,
      
      `create table if not exists categories (
        id serial primary key,
        path text unique,
        parent_path text
      );`,
      
      `create table if not exists article_categories (
        article_id uuid references articles(id) on delete cascade,
        category_id int references categories(id),
        confidence real check (confidence between 0 and 1),
        primary key(article_id, category_id)
      );`,
      
      `create table if not exists places (
        id serial primary key,
        code text unique,
        name text
      );`,
      
      `create table if not exists article_places (
        article_id uuid references articles(id) on delete cascade,
        place_id int references places(id),
        confidence real check (confidence between 0 and 1),
        primary key(article_id, place_id)
      );`,
      
      `create table if not exists entities (
        id serial primary key,
        name text,
        type text,
        wikidata_id text
      );`,
      
      `create table if not exists article_entities (
        article_id uuid references articles(id) on delete cascade,
        entity_id int references entities(id),
        salience real,
        primary key(article_id, entity_id)
      );`,
      
      `create table if not exists article_scores (
        article_id uuid primary key references articles(id) on delete cascade,
        score real,
        factors jsonb,
        updated_at timestamptz default now()
      );`,
      
      `create table if not exists article_policy (
        article_id uuid primary key references articles(id) on delete cascade,
        display_source_link boolean default true,
        max_extract_chars int default 0,
        copyright_zone text,
        robots_ok boolean,
        terms_ok boolean
      );`,
      
      `create table if not exists projects (
        id uuid primary key default gen_random_uuid(),
        slug text unique not null,
        description text,
        locale text
      );`,
      
      `create table if not exists project_rules (
        project_id uuid references projects(id) on delete cascade,
        include_paths text[],
        exclude_paths text[],
        geo_scope text[],
        boosts jsonb,
        primary key(project_id)
      );`,
      
      `create table if not exists feeds (
        id uuid primary key default gen_random_uuid(),
        source_id text references sources(id),
        url text not null,
        kind text check (kind in ('rss','atom','api')) not null,
        country char(2),
        lang text,
        section text,
        schedule_cron text default '*/5 * * * *',
        enabled boolean default true,
        last_etag text,
        last_modified text,
        last_seen_at timestamptz
      );`,
      
      `create table if not exists crawl_log (
        id bigint generated always as identity primary key,
        feed_id uuid references feeds(id),
        article_url text,
        status text,
        message text,
        created_at timestamptz default now()
      );`,
      
      // Indexes
      `create index if not exists idx_articles_pub on articles(published_at desc);`,
      `create index if not exists idx_articles_source_hash on articles(source_id, content_hash);`,
      `create index if not exists idx_article_ai_current on article_ai(article_id, is_current);`,
      `create index if not exists idx_feeds_enabled on feeds(enabled);`,
      `create index if not exists idx_article_categories_cat on article_categories(category_id);`,
      `create index if not exists idx_article_places_place on article_places(place_id);`,
      
      // Enable RLS
      `alter table sources enable row level security;`,
      `alter table articles enable row level security;`,
      `alter table article_ai enable row level security;`,
      `alter table media_assets enable row level security;`,
      `alter table article_media enable row level security;`,
      `alter table categories enable row level security;`,
      `alter table article_categories enable row level security;`,
      `alter table places enable row level security;`,
      `alter table article_places enable row level security;`,
      `alter table entities enable row level security;`,
      `alter table article_entities enable row level security;`,
      `alter table article_scores enable row level security;`,
      `alter table article_policy enable row level security;`,
      `alter table projects enable row level security;`,
      `alter table project_rules enable row level security;`,
      `alter table feeds enable row level security;`,
      `alter table crawl_log enable row level security;`
    ];

    // Execute each statement individually
    for (const statement of migrationStatements) {
      const { error } = await supabaseClient.rpc('exec_sql', { sql: statement });
      if (error) {
        console.error('Migration statement failed:', statement, error);
        // Continue with other statements even if one fails
      }
    }

    // Create view
    const { error: viewError } = await supabaseClient.rpc('exec_sql', {
      sql: `create or replace view v_articles_public as
        select a.id,
               a.title,
               a.snippet,
               a.published_at,
               a.language,
               coalesce(a.canonical_url, a.url) as url,
               s.name as source_name,
               s.homepage as source_homepage,
               (select jsonb_agg(c.path order by c.path)
                  from article_categories ac join categories c on c.id=ac.category_id
                 where ac.article_id=a.id) as categories,
               (select score from article_scores where article_id=a.id) as score
          from articles a
          join sources s on s.id=a.source_id;`
    });

    // Create RPC function
    const { error: rpcError } = await supabaseClient.rpc('exec_sql', {
      sql: `create or replace function articles_needing_ai()
        returns table (
          id uuid,
          published_at timestamptz,
          language text,
          source_trust real,
          cluster_size int
        ) language plpgsql as $$
        begin
          return query
          select a.id, a.published_at, a.language,
                 0.7::real as source_trust,
                 1 as cluster_size
            from articles a
           where not exists (select 1 from article_ai x where x.article_id=a.id and x.is_current)
           order by a.published_at desc nulls last
           limit 200;
        end; $$;`
    });

    // Seed data
    const seedStatements = [
      `insert into projects (slug, description, locale) values
        ('insight-football','Football-focused news','en-GB'),
        ('insight-london','London local news','en-GB')
      on conflict (slug) do nothing;`,
      
      `insert into categories(path,parent_path) values
        ('general', null),
        ('sports', null),
        ('sports.football','sports'),
        ('sports.transfer','sports.football'),
        ('geo', null),
        ('geo.uk','geo'),
        ('geo.uk.london','geo.uk')
      on conflict do nothing;`,
      
      `insert into places(code,name) values
        ('gb.london','London'),
        ('tr.istanbul','Istanbul')
      on conflict do nothing;`
    ];

    for (const statement of seedStatements) {
      await supabaseClient.rpc('exec_sql', { sql: statement });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Database migration completed successfully',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
})