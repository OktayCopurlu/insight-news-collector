import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const seedData = async () => {
  console.log("🌱 Starting database seeding...");

  try {
    // 1. Insert sample sources
    console.log("📰 Adding news sources...");
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .upsert(
        [
          {
            id: "bbc-news",
            name: "BBC News",
            homepage: "https://www.bbc.com/news",
            country: "GB",
            lang: "en",
            terms_url: "https://www.bbc.com/terms",
            allowed_use: "link+snippet",
            canonical_link_required: true,
          },
          {
            id: "reuters",
            name: "Reuters",
            homepage: "https://www.reuters.com",
            country: "US",
            lang: "en",
            terms_url: "https://www.reuters.com/terms-of-use",
            allowed_use: "link+snippet",
            canonical_link_required: true,
          },
          {
            id: "sky-sports",
            name: "Sky Sports",
            homepage: "https://www.skysports.com",
            country: "GB",
            lang: "en",
            terms_url: "https://www.skysports.com/terms-conditions",
            allowed_use: "link+snippet",
            canonical_link_required: true,
          },
          {
            id: "guardian",
            name: "The Guardian",
            homepage: "https://www.theguardian.com",
            country: "GB",
            lang: "en",
            terms_url: "https://www.theguardian.com/help/terms-of-service",
            allowed_use: "link+snippet",
            canonical_link_required: true,
          },
        ],
        { onConflict: "id" }
      )
      .select();

    if (sourcesError) throw sourcesError;
    console.log(`✅ Added ${sources.length} sources`);

    // 2. Insert sample feeds
    console.log("📡 Adding RSS feeds...");
    const { data: feeds, error: feedsError } = await supabase
      .from("feeds")
      .upsert([
        {
          source_id: "bbc-news",
          url: "http://feeds.bbci.co.uk/news/rss.xml",
          kind: "rss",
          country: "GB",
          lang: "en",
          section: "general",
          enabled: true,
        },
        {
          source_id: "bbc-news",
          url: "http://feeds.bbci.co.uk/sport/rss.xml",
          kind: "rss",
          country: "GB",
          lang: "en",
          section: "sports",
          enabled: true,
        },
        {
          source_id: "reuters",
          url: "https://www.reuters.com/rssFeed/worldNews",
          kind: "rss",
          country: "US",
          lang: "en",
          section: "world",
          enabled: true,
        },
        {
          source_id: "sky-sports",
          url: "https://www.skysports.com/rss/12040",
          kind: "rss",
          country: "GB",
          lang: "en",
          section: "football",
          enabled: true,
        },
        {
          source_id: "guardian",
          url: "https://www.theguardian.com/uk/rss",
          kind: "rss",
          country: "GB",
          lang: "en",
          section: "uk-news",
          enabled: true,
        },
      ])
      .select();

    if (feedsError) throw feedsError;
    console.log(`✅ Added ${feeds.length} feeds`);

    // 3. Insert sample articles
    console.log("📄 Adding sample articles...");
    const sampleArticles = [
      {
        source_id: "bbc-news",
        url: "https://www.bbc.com/news/uk-politics-12345678",
        canonical_url: "https://www.bbc.com/news/uk-politics-12345678",
        title: "UK Government Announces New Climate Policy",
        snippet:
          "The government has unveiled ambitious new targets for carbon emissions reduction, aiming to achieve net zero by 2050. The policy includes significant investments in renewable energy and green technology.",
        language: "en",
        published_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        content_hash: "abc123def456",
      },
      {
        source_id: "sky-sports",
        url: "https://www.skysports.com/football/news/11095/12345679",
        canonical_url: "https://www.skysports.com/football/news/11095/12345679",
        title: "Premier League Transfer News: Major Signing Confirmed",
        snippet:
          "Manchester United have completed the signing of a world-class midfielder in a deal worth £80 million. The player is expected to make his debut this weekend.",
        language: "en",
        published_at: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        content_hash: "def456ghi789",
      },
      {
        source_id: "reuters",
        url: "https://www.reuters.com/world/europe/breaking-news-12345680",
        canonical_url:
          "https://www.reuters.com/world/europe/breaking-news-12345680",
        title: "European Markets Show Strong Growth",
        snippet:
          "Stock markets across Europe posted significant gains today, with the FTSE 100 up 2.3% and the DAX climbing 1.8%. Analysts cite positive economic indicators and strong corporate earnings.",
        language: "en",
        published_at: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        content_hash: "ghi789jkl012",
      },
      {
        source_id: "guardian",
        url: "https://www.theguardian.com/uk-news/2024/jan/15/london-transport-12345681",
        canonical_url:
          "https://www.theguardian.com/uk-news/2024/jan/15/london-transport-12345681",
        title: "London Transport Strike Causes Major Disruption",
        snippet:
          "Thousands of commuters faced travel chaos as transport workers staged a 24-hour strike over pay and working conditions. Alternative arrangements have been put in place.",
        language: "en",
        published_at: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
        content_hash: "jkl012mno345",
      },
      {
        source_id: "bbc-news",
        url: "https://www.bbc.com/news/technology-12345682",
        canonical_url: "https://www.bbc.com/news/technology-12345682",
        title: "AI Technology Breakthrough Announced",
        snippet:
          "Researchers have developed a new artificial intelligence system that can process natural language with unprecedented accuracy. The technology could revolutionize customer service and education.",
        language: "en",
        published_at: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        content_hash: "mno345pqr678",
      },
    ];

    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .upsert(sampleArticles)
      .select();

    if (articlesError) throw articlesError;
    console.log(`✅ Added ${articles.length} articles`);

    // 4. Skipped: legacy per-article AI enhancements seeding removed (cluster-first now uses cluster_ai)

    // 5. Add article categories
    console.log("🏷️ Adding article categories...");
    const articleCategories = [
      { article_id: articles[0].id, category_id: 1, confidence: 0.9 }, // general
      { article_id: articles[1].id, category_id: 2, confidence: 0.95 }, // sports
      { article_id: articles[1].id, category_id: 3, confidence: 0.9 }, // sports.football
      { article_id: articles[2].id, category_id: 1, confidence: 0.8 }, // general
      { article_id: articles[3].id, category_id: 5, confidence: 0.85 }, // geo
      { article_id: articles[3].id, category_id: 6, confidence: 0.9 }, // geo.uk
      { article_id: articles[3].id, category_id: 7, confidence: 0.95 }, // geo.uk.london
      { article_id: articles[4].id, category_id: 1, confidence: 0.8 }, // general
    ];

    const { data: categories, error: categoriesError } = await supabase
      .from("article_categories")
      .upsert(articleCategories, { onConflict: "article_id,category_id" })
      .select();

    if (categoriesError) throw categoriesError;
    console.log(`✅ Added ${categories.length} article categories`);

    // 6. Add article scores
    console.log("📊 Adding article scores...");
    const articleScores = articles.map((article) => ({
      article_id: article.id,
      score: Math.random() * 0.4 + 0.6, // Random score between 0.6 and 1.0
      factors: {
        recency: Math.random() * 0.3 + 0.7,
        titleLength: Math.random() * 0.2 + 0.8,
        hasSnippet: 1.0,
        sourceReliability: Math.random() * 0.2 + 0.8,
      },
    }));

    const { data: scores, error: scoresError } = await supabase
      .from("article_scores")
      .upsert(articleScores, { onConflict: "article_id" })
      .select();

    if (scoresError) throw scoresError;
    console.log(`✅ Added ${scores.length} article scores`);

    // 7. Add some crawl logs
    console.log("📝 Adding crawl logs...");
    const crawlLogs = feeds.slice(0, 3).map((feed) => ({
      feed_id: feed.id,
      article_url: "https://example.com/sample-article",
      status: "success",
      message: "Article processed successfully",
    }));

    const { data: logs, error: logsError } = await supabase
      .from("crawl_log")
      .insert(crawlLogs)
      .select();

    if (logsError) throw logsError;
    console.log(`✅ Added ${logs.length} crawl logs`);

    console.log("\n🎉 Database seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log(`   • ${sources.length} news sources`);
    console.log(`   • ${feeds.length} RSS feeds`);
    console.log(`   • ${articles.length} sample articles`);
    // Skipped: AI enhancements (legacy per-article AI) — not seeded
    console.log(`   • ${categories.length} article categories`);
    console.log(`   • ${scores.length} article scores`);
    console.log(`   • ${logs.length} crawl logs`);

    console.log("\n🚀 You can now test the API endpoints:");
    console.log("   • GET /api/sources - List all sources");
    console.log("   • GET /api/feeds - List all feeds");
    // Removed: /api/articles endpoints (use /api/clusters and BFF endpoints)
    console.log("   • GET /health - Check server health");
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    process.exit(1);
  }
};

seedData();
