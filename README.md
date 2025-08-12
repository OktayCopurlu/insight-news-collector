# Insight Feeder Backend

A comprehensive news aggregation and AI enhancement system built with Node.js, Supabase, and Gemini AI.

## Features

- **RSS/Atom Feed Parsing**: Automatically crawl and parse news feeds
- **AI Enhancement**: Use Google Gemini to enhance articles with better titles, summaries, and categorization
- **Source Management**: Manage news sources and their feeds
- **Article Processing**: Automatic deduplication, scoring, and categorization
- **RESTful API**: Complete API for managing feeds, articles, and sources
- **Scheduled Tasks**: Automated crawling and AI processing with cron jobs
- **Rate Limiting**: Built-in rate limiting for API endpoints
- **Comprehensive Logging**: Structured logging with different levels

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
- `GET /health` - Server health status

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