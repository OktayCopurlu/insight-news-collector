import { selectRecords, updateRecord, insertRecord } from '../config/database.js';
import { parseFeed } from './feedParser.js';
import { processArticle } from './articleProcessor.js';
import { createContextLogger } from '../config/logger.js';
import { isValidUrl } from '../utils/helpers.js';

const logger = createContextLogger('FeedCrawler');

export const crawlFeed = async (feed) => {
  const crawlLogger = createContextLogger(`FeedCrawler:${feed.id}`);
  
  try {
    // Validate feed URL before processing
    if (!feed.url || !isValidUrl(feed.url)) {
      const errorMsg = `Invalid feed URL: ${feed.url || 'undefined'}`;
      crawlLogger.error(errorMsg, { feedId: feed.id });
      throw new Error(errorMsg);
    }

    crawlLogger.info('Starting feed crawl', { 
      feedUrl: feed.url,
      sourceId: feed.source_id 
    });

    const parseOptions = {
      lastEtag: feed.last_etag,
      lastModified: feed.last_modified
    };

    const result = await parseFeed(feed.url, parseOptions);

    if (result.notModified) {
      crawlLogger.info('Feed not modified, skipping processing');
      await updateFeedLastSeen(feed.id);
      return { processed: 0, skipped: 0, errors: 0 };
    }

    // Update feed metadata
    await updateRecord('feeds', feed.id, {
      last_etag: result.etag,
      last_modified: result.lastModified,
      last_seen_at: new Date()
    });

    const stats = { processed: 0, skipped: 0, errors: 0 };
    const maxItems = parseInt(process.env.MAX_ITEMS_PER_RUN) || 500;
    const itemsToProcess = result.items.slice(0, maxItems);

    crawlLogger.info('Processing feed items', { 
      totalItems: result.items.length,
      processingItems: itemsToProcess.length 
    });

    for (const item of itemsToProcess) {
      try {
        await processArticle(item, feed.source_id);
        stats.processed++;
        
        // Log successful processing
        await logCrawlResult(feed.id, item.url, 'success', 'Article processed successfully');
        
      } catch (error) {
        stats.errors++;
        crawlLogger.warn('Failed to process article', { 
          url: item.url,
          error: error.message 
        });
        
        // Log error
        await logCrawlResult(feed.id, item.url, 'error', error.message);
      }
    }

    crawlLogger.info('Feed crawl completed', stats);
    return stats;

  } catch (error) {
    crawlLogger.error('Feed crawl failed', { 
      feedUrl: feed.url,
      error: error.message 
    });
    
    await logCrawlResult(feed.id, feed.url, 'feed_error', error.message);
    throw error;
  }
};

export const crawlAllFeeds = async () => {
  try {
    logger.info('Starting crawl of all enabled feeds');

    const feeds = await selectRecords('feeds', { enabled: true });
    
    if (feeds.length === 0) {
      logger.warn('No enabled feeds found');
      return { totalFeeds: 0, successful: 0, failed: 0 };
    }

    logger.info('Found enabled feeds', { count: feeds.length });

    const results = { totalFeeds: feeds.length, successful: 0, failed: 0 };
    const crawlPromises = feeds.map(async (feed) => {
      try {
        await crawlFeed(feed);
        results.successful++;
      } catch (error) {
        results.failed++;
        logger.error('Feed crawl failed', { 
          feedId: feed.id,
          feedUrl: feed.url,
          error: error.message 
        });
      }
    });

    // Process feeds concurrently but with reasonable limits
    const batchSize = 5;
    for (let i = 0; i < crawlPromises.length; i += batchSize) {
      const batch = crawlPromises.slice(i, i + batchSize);
      await Promise.all(batch);
    }

    logger.info('All feeds crawl completed', results);
    return results;

  } catch (error) {
    logger.error('Failed to crawl all feeds', { error: error.message });
    throw error;
  }
};

export const crawlFeedById = async (feedId) => {
  try {
    const feeds = await selectRecords('feeds', { id: feedId });
    
    if (feeds.length === 0) {
      throw new Error(`Feed not found: ${feedId}`);
    }

    const feed = feeds[0];
    
    if (!feed.enabled) {
      throw new Error(`Feed is disabled: ${feedId}`);
    }

    return await crawlFeed(feed);
  } catch (error) {
    logger.error('Failed to crawl feed by ID', { 
      feedId,
      error: error.message 
    });
    throw error;
  }
};

const updateFeedLastSeen = async (feedId) => {
  try {
    await updateRecord('feeds', feedId, {
      last_seen_at: new Date()
    });
  } catch (error) {
    logger.warn('Failed to update feed last seen', { 
      feedId,
      error: error.message 
    });
  }
};

const logCrawlResult = async (feedId, articleUrl, status, message) => {
  try {
    await insertRecord('crawl_log', {
      feed_id: feedId,
      article_url: articleUrl,
      status,
      message: message.substring(0, 500) // Limit message length
    });
  } catch (error) {
    // Don't throw - logging failures shouldn't stop processing
    logger.warn('Failed to log crawl result', { 
      feedId,
      articleUrl,
      error: error.message 
    });
  }
};

export const getFeedStats = async (feedId) => {
  try {
    const feed = await selectRecords('feeds', { id: feedId }, { limit: 1 });
    
    if (feed.length === 0) {
      throw new Error(`Feed not found: ${feedId}`);
    }

    // Get recent crawl logs
    const logs = await selectRecords('crawl_log', 
      { feed_id: feedId }, 
      { 
        orderBy: { column: 'created_at', ascending: false },
        limit: 100 
      }
    );

    const stats = {
      feed: feed[0],
      recentLogs: logs.slice(0, 10),
      summary: {
        totalLogs: logs.length,
        successCount: logs.filter(log => log.status === 'success').length,
        errorCount: logs.filter(log => log.status === 'error').length,
        lastCrawl: logs.length > 0 ? logs[0].created_at : null
      }
    };

    return stats;
  } catch (error) {
    logger.error('Failed to get feed stats', { 
      feedId,
      error: error.message 
    });
    throw error;
  }
};