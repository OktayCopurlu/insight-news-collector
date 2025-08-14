# Insight Feeder Backend

A comprehensive news aggregation and AI enhancement system built with Node.js, Supabase, and Gemini AI.

## Quick Start

1. Clone the repository:

   ```bash
   git clone <your-repo-url>
   cd insight-feeder-backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. Set up the database:

   - Create a Supabase project
   - Run the SQL migration from `migrations/-- Migration: 0001_init.txt` in your Supabase SQL Editor
   - Or use the manual setup instructions in `MANUAL_SETUP.md`

5. Seed the database (optional):

   ```bash
   npm run seed
   ```

6. Start the development server:
   ```bash
   npm run dev
   ```

## Features

- **RSS/Atom Feed Parsing**: Automatically crawl and parse news feeds
- **AI Enhancement**: Use Google Gemini to enhance articles with better titles, summaries, and categorization
- **Source Management**: Manage news sources and their feeds
- **Article Processing**: Automatic deduplication, scoring, and categorization
- **RESTful API**: Complete API for managing feeds, articles, and sources
- **Scheduled Tasks**: Automated crawling and AI processing with cron jobs
- **Rate Limiting**: Built-in rate limiting for API endpoints
- **Comprehensive Logging**: Structured logging with different levels
- **Media (Phase 1)**: Attach publisher image via OpenGraph/Twitter/JSON-LD meta (optional)

## Prerequisites

- Node.js 18+
- Supabase account and project
- Google Gemini API key

## Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment file and configure:

   ```bash
   cp .env.example .env
   ```

4. Set up your Supabase database by running the migration in `migrations/0001_init.sql`

5. Configure your environment variables in `.env`:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
   - `LLM_API_KEY`: Your Google Gemini API key
   - Other configuration as needed

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## API Endpoints

### Health Check

- `GET /health` - Server health status (includes cached DB status)
- `GET /health/db` - Live database connectivity check (503 if disconnected)

### Sources

- `GET /api/sources` - List all sources
- `GET /api/sources/:id` - Get source by ID
- `POST /api/sources` - Create new source
- `PUT /api/sources/:id` - Update source
- `GET /api/sources/:id/stats` - Get source statistics

### Feeds

- `GET /api/feeds` - List all feeds
- `GET /api/feeds/:id` - Get feed by ID
- `POST /api/feeds` - Create new feed
- `PUT /api/feeds/:id` - Update feed
- `POST /api/feeds/:id/crawl` - Manually crawl feed
- `GET /api/feeds/:id/stats` - Get feed statistics
- `POST /api/feeds/validate` - Validate feed URL

### Articles

- `GET /api/articles` - List articles with filtering and pagination
- `GET /api/articles/:id` - Get article by ID
- `GET /api/articles/ai/pending` - Get articles needing AI processing
- `POST /api/articles/:id/ai` - Process AI enhancement for article
- `GET /api/articles/search` - Search articles
- `GET /api/articles/stats/overview` - Get article statistics

### Clusters (Backend only; frontend integration deferred)

- `GET /api/clusters/reps` — One representative per cluster (uses `v_cluster_reps`). Query: `limit`, `offset`, `order=asc|desc`, `lang`, `includeAI=true|false`.
- `GET /api/clusters/:id` — Cluster detail including current AI summary (by `lang`), timeline updates, and articles.
- `GET /api/clusters/:id/updates` — Timeline updates only.

Enable clustering by environment flags (off by default):

- `CLUSTERING_ENABLED=true` — activates similarity-based assignment during ingestion (trigram, 72h window; thresholds configurable).
- `CLUSTER_TRGM_THRESHOLD=0.55` — similarity threshold (0.5–0.6 recommended for MVP).
- `CLUSTER_TRGM_WINDOW_HOURS=72` — time window for candidate search.
- `CLUSTER_TRGM_LIMIT=10` — top-N candidates.
- `CLUSTER_ENRICH_ENABLED=true` — allow summarization job (stub or LLM).
- `CLUSTER_LLM_ENABLED=true` — use real LLM in enricher; otherwise falls back to rule-based summary.
- `CLUSTER_LANG=en` — default summary language.
- `CLUSTER_LLM_SLEEP_MS=250` — sleep between LLM calls to rate-limit.

Timeline update extraction (generic; opt-in):

### Media (Phase 1)

Enable attaching a thumbnail image to new articles using page metadata. Sources checked: `og:image`, `twitter:image`, `link[rel=image_src]`, and JSON-LD `image`/`thumbnailUrl`/`logo`. This is off by default.

Flags:

- `MEDIA_ENABLED=false`
- `MEDIA_FROM_HTML_META=true`
- `MEDIA_FROM_RSS=true` (use <media:content>, <media:thumbnail>, <enclosure type="image/*"> when available)
- `MEDIA_VERIFY_HEAD=false` (disabled by default to avoid extra requests)
- `MEDIA_MIN_WIDTH=800` (set to 0 to disable)
- `MEDIA_ACCEPTED_ASPECTS=16:9,4:3` (empty to allow any)

Storage mirroring (optional, Phase 2):

- `MEDIA_STORAGE_ENABLED=false`
- `MEDIA_STORAGE_BUCKET=news-media`
- `MEDIA_MAX_DOWNLOAD_BYTES=3000000`
- `MEDIA_VARIANTS_ENABLED=false` (generate responsive variants via sharp)
- `MEDIA_VARIANT_WIDTHS=400,800,1200` (comma-separated widths)

OG-card fallback (optional, Phase 3):

- `MEDIA_FALLBACK_OGCARD_ENABLED=false`
- `OGCARD_WIDTH=1200`
- `OGCARD_HEIGHT=630`
- `OGCARD_BG=#0F172A`
- `OGCARD_FG=#FFFFFF`
- `OGCARD_ACCENT=#38BDF8`

Stock fallback (optional):

- `MEDIA_STOCK_ENABLED=false`
- `STOCK_CONFIG_PATH=stock-config.json` (see `stock-config.example.json` for format)

Policy:

- `MEDIA_MIRROR_DEFAULT_ALLOW=false` — if source/article policy doesn’t explicitly allow mirroring, fall back to this default (false recommended)

Utilities:

- AI illustration fallback (optional):

  - `MEDIA_AI_ENABLED=false`
  - `AI_IMAGE_PROVIDER=svg` (currently only SVG abstract generator is supported)
  - `AI_IMAGE_WIDTH=1200` (defaults to OGCARD_WIDTH)
  - `AI_IMAGE_HEIGHT=630` (defaults to OGCARD_HEIGHT)

- `npm run media:test https://example.com/article`
- `npm run media:backfill` — processes recent articles missing images
- `npm run media:audit [hours]` — prints coverage of articles without images in the last N hours

- `CLUSTER_UPDATE_RULES_ENABLED=false` — enable lightweight heuristic stance detection for headlines (generic EN/TR examples; safe to keep off by default).
- `CLUSTER_UPDATE_STANCE_MODE=off` — set to `llm` to use a tiny LLM call to classify stance into supports|contradicts|neutral (JSON-only output, token-capped).
- `CLUSTER_UPDATE_STANCE_LLM_TOKENS=120` — token cap for the stance classifier.

## Configuration

### Environment Variables

Key environment variables:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database access
- `LLM_API_KEY`: Google Gemini API key
- `LLM_MODEL`: Gemini model to use (default: gemini-1.5-flash)
- `EDGE_TOKEN`: Optional authentication token for API access
- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

### Scheduled Tasks

The system runs several automated tasks:

- **Feed Crawling**: Every 5 minutes
- **AI Processing**: Every 10 minutes
- **Log Cleanup**: Daily at 2 AM UTC

## Architecture

### Functional Programming Approach

This implementation uses functional programming principles:

- Pure functions where possible
- Immutable data structures
- Function composition
- No classes or OOP patterns
- Modular, reusable functions

### Key Components

- **Feed Parser**: RSS/Atom feed parsing and validation
- **Article Processor**: Article deduplication, scoring, and enhancement
- **Gemini Service**: AI-powered content enhancement using Google Gemini
- **Feed Crawler**: Automated feed crawling with error handling
- **Database Layer**: Supabase integration with helper functions
- **API Routes**: RESTful endpoints for all operations
- **Scheduler**: Cron job management for automated tasks

### Database Schema

The system uses a comprehensive PostgreSQL schema with:

- Sources and feeds management
- Article storage with deduplication
- AI enhancement tracking
- Categorization and scoring
- Audit logging

## Error Handling

- Comprehensive error logging
- Graceful degradation for AI failures
- Rate limiting protection
- Input validation
- Database transaction safety

## Security

- Helmet.js for security headers
- CORS configuration
- Rate limiting
- Input sanitization
- Optional token-based authentication

## Monitoring

- Structured logging with context
- Health check endpoint
- Statistics endpoints
- Crawl result tracking

## Contributing

1. Follow functional programming principles
2. Add comprehensive error handling
3. Include logging for debugging
4. Write clear, descriptive function names
5. Add input validation

## License

MIT License

## Testing

### End-to-End (E2E) Tests

This project includes a lightweight E2E test suite focused on verifying:

1. API availability via the `/health` endpoint.
2. Supabase database connectivity (simple query + connection test via internal helper).
3. Optional manual live DB check via `/health/db` (not exercised automatically to keep suite fast).

### Running Tests

```bash
npm test
```

The test runner uses Jest in ESM mode (`--experimental-vm-modules`).

### Environment Requirements

Database-related tests require the following environment variables (from `.env` or `.env.test`):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_ANON_KEY`

If these variables are missing locally, the DB-specific tests are skipped (so you can still run the suite without credentials). In CI (when `CI` env var is set) missing variables will cause the run to fail early.

### Adding More Tests

Create additional test files under `tests/e2e/` (or a new `tests/unit/` directory) and they will be picked up automatically by Jest.

If you add async services (cron jobs, external network calls), prefer mocking those in unit tests to keep E2E fast and deterministic.

### Troubleshooting

If Jest warns about open handles, run:

```bash
npm test -- --detectOpenHandles
```

This will help identify lingering async operations.
