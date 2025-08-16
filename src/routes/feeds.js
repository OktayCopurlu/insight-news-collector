import express from 'express';
import { selectRecords, insertRecord, updateRecord } from '../config/database.js';
import { crawlFeedById, getFeedStats } from '../services/feedCrawler.js';
import { validateFeedUrl, extractFeedMetadata } from '../services/feedParser.js';
import { createContextLogger } from '../config/logger.js';
import { isValidUrl } from '../utils/helpers.js';

const router = express.Router();
const logger = createContextLogger('FeedsAPI');

// Get all feeds
router.get('/', async (req, res) => {
  try {
    const { source_id, enabled } = req.query;
    const filters = {};
    
    if (source_id) filters.source_id = source_id;
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    
    const feeds = await selectRecords('feeds', filters, {
      orderBy: { column: 'created_at', ascending: false }
    });
    
    res.json({
      success: true,
      data: feeds,
      count: feeds.length
    });
  } catch (error) {
    logger.error('Failed to get feeds', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feeds'
    });
  }
});

// Get feed by ID
router.get('/:id', async (req, res) => {
  try {
    const feeds = await selectRecords('feeds', { id: req.params.id });
    
    if (feeds.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feed not found'
      });
    }
    
    res.json({
      success: true,
      data: feeds[0]
    });
  } catch (error) {
    logger.error('Failed to get feed', { feedId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feed'
    });
  }
});

// Create new feed
router.post('/', async (req, res) => {
  try {
    const { source_id, url, kind, country, lang, section, schedule_cron, enabled } = req.body;
    
    // Validation
    if (!source_id || !url || !kind) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source_id, url, kind'
      });
    }
    
    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }
    
    if (!['rss', 'atom', 'api'].includes(kind)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid kind. Must be: rss, atom, or api'
      });
    }
    
    // Validate feed URL
    const validation = await validateFeedUrl(url);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Feed URL validation failed',
        details: validation.error
      });
    }
    
    // Check if feed already exists
    const existingFeeds = await selectRecords('feeds', { url });
    if (existingFeeds.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Feed URL already exists'
      });
    }
    
    const feed = await insertRecord('feeds', {
      source_id,
      url,
      kind,
      country: country || null,
      lang: lang || null,
      section: section || null,
      schedule_cron: schedule_cron || '*/5 * * * *',
      enabled: enabled !== false
    });
    
    logger.info('Feed created', { feedId: feed.id, url });
    
    res.status(201).json({
      success: true,
      data: feed
    });
  } catch (error) {
    logger.error('Failed to create feed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create feed'
    });
  }
});

// Update feed
router.put('/:id', async (req, res) => {
  try {
    const { url, kind, country, lang, section, schedule_cron, enabled } = req.body;
    
    const updates = {};
    if (url !== undefined) {
      if (!isValidUrl(url)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL format'
        });
      }
      updates.url = url;
    }
    if (kind !== undefined) {
      if (!['rss', 'atom', 'api'].includes(kind)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid kind. Must be: rss, atom, or api'
        });
      }
      updates.kind = kind;
    }
    if (country !== undefined) updates.country = country;
    if (lang !== undefined) updates.lang = lang;
    if (section !== undefined) updates.section = section;
    if (schedule_cron !== undefined) updates.schedule_cron = schedule_cron;
    if (enabled !== undefined) updates.enabled = enabled;
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }
    
    const feed = await updateRecord('feeds', req.params.id, updates);
    
    logger.info('Feed updated', { feedId: req.params.id });
    
    res.json({
      success: true,
      data: feed
    });
  } catch (error) {
    logger.error('Failed to update feed', { feedId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update feed'
    });
  }
});

// Crawl feed manually
router.post('/:id/crawl', async (req, res) => {
  try {
    const stats = await crawlFeedById(req.params.id);
    
    logger.info('Manual feed crawl completed', { feedId: req.params.id, stats });
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Manual feed crawl failed', { feedId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to crawl feed'
    });
  }
});

// Get feed statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const stats = await getFeedStats(req.params.id);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Failed to get feed stats', { feedId: req.params.id, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feed statistics'
    });
  }
});

// Validate feed URL
router.post('/validate', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }
    
    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }
    
    const validation = await validateFeedUrl(url);
    
    let metadata = null;
    if (validation.valid) {
      try {
        metadata = await extractFeedMetadata(url);
      } catch (error) {
        logger.warn('Failed to extract feed metadata', { url, error: error.message });
      }
    }
    
    res.json({
      success: true,
      data: {
        ...validation,
        metadata
      }
    });
  } catch (error) {
    logger.error('Feed validation failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to validate feed'
    });
  }
});

export default router;