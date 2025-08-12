import express from 'express';
import { selectRecords, insertRecord, updateRecord } from '../config/database.js';
import { processArticleAI, getArticlesNeedingAI } from '../services/articleProcessor.js';
import { createContextLogger } from '../config/logger.js';
import { searchRateLimit, aiRateLimit } from '../middleware/rateLimiter.js';

const router = express.Router();
const logger = createContextLogger('ArticlesAPI');

// Search articles (must come before /:id route)
router.get('/search', searchRateLimit, async (req, res) => {
  try {
    const { q, source_id, category, language, limit = 50, offset = 0 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }
    
    let query = supabase
      .from('v_articles_public')
      .select('*')
      .textSearch('title', q.trim())
      .order('published_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    if (source_id) {
      query = query.eq('source_id', source_id);
    }
    
    if (language) {
      query = query.eq('language', language);
    }
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      total: count,
      query: q.trim()
    });
  } catch (error) {
    logger.error('Article search failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

// Get articles needing AI processing
router.get('/ai/pending', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const articles = await getArticlesNeedingAI(parseInt(limit));
    
    res.json({
      success: true,
      data: articles,
      count: articles.length
    });
  } catch (error) {
    logger.error('Failed to get articles needing AI', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve articles needing AI processing'
    });
  }
});

// Get article statistics overview
router.get('/stats/overview', async (req, res) => {
  try {
    const { data: totalCount } = await supabase
      .from('articles')
      .select('id', { count: 'exact', head: true });
    
    const { data: recentCount } = await supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
    const { data: aiProcessedCount } = await supabase
      .from('article_ai')
      .select('article_id', { count: 'exact', head: true })
      .eq('is_current', true);
    
    const stats = {
      total_articles: totalCount || 0,
      recent_articles_24h: recentCount || 0,
      ai_processed: aiProcessedCount || 0,
      ai_pending: Math.max(0, (totalCount || 0) - (aiProcessedCount || 0))
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Failed to get article stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve article statistics'
    });
  }
});

// Get all articles with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { 
      source_id, 
      category, 
      language, 
      limit = 50, 
      offset = 0,
      sort = 'published_at',
      order = 'desc'
    } = req.query;
    
    const filters = {};
    if (source_id) filters.source_id = source_id;
    if (language) filters.language = language;
    
    const options = {
      orderBy: { 
        column: sort, 
        ascending: order === 'asc' 
      },
      limit: Math.min(parseInt(limit), 100), // Cap at 100
      offset: parseInt(offset)
    };
    
    const articles = await selectRecords('articles', filters, options);
    
    res.json({
      success: true,
      data: articles,
      count: articles.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Failed to get articles', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve articles'
    });
  }
});

// Get article by ID
router.get('/:id', async (req, res) => {
  try {
    const articles = await selectRecords('articles', { id: req.params.id });
    
    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    const article = articles[0];
    
    // Get AI enhancement if available
    const aiEnhancements = await selectRecords('article_ai', {
      article_id: req.params.id,
      is_current: true
    });
    
    // Get categories
    const { data: categories } = await supabase
      .from('article_categories')
      .select(`
        confidence,
        categories (
          path
        )
      `)
      .eq('article_id', req.params.id);
    
    const enrichedArticle = {
      ...article,
      ai_enhancement: aiEnhancements[0] || null,
      categories: categories?.map(c => ({
        path: c.categories.path,
        confidence: c.confidence
      })) || []
    };
    
    res.json({
      success: true,
      data: enrichedArticle
    });
  } catch (error) {
    logger.error('Failed to get article', { articleId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve article'
    });
  }
});

// Process AI enhancement for article
router.post('/:id/ai', aiRateLimit, async (req, res) => {
  try {
    const articles = await selectRecords('articles', { id: req.params.id });
    
    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    const article = articles[0];
    
    // Check if AI processing already exists
    const existingAI = await selectRecords('article_ai', {
      article_id: req.params.id,
      is_current: true
    });
    
    if (existingAI.length > 0) {
      return res.json({
        success: true,
        data: existingAI[0],
        message: 'AI enhancement already exists'
      });
    }
    
    const aiResult = await processArticleAI(article);
    
    logger.info('AI processing completed', { articleId: req.params.id });
    
    res.json({
      success: true,
      data: aiResult
    });
  } catch (error) {
    logger.error('AI processing failed', { articleId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to process AI enhancement'
    });
  }
});

export default router;