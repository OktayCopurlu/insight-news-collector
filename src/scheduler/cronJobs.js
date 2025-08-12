import cron from 'node-cron';
import { crawlAllFeeds } from '../services/feedCrawler.js';
import { getArticlesNeedingAI, processArticleAI } from '../services/articleProcessor.js';
import { selectRecords } from '../config/database.js';
import { createContextLogger } from '../config/logger.js';

const logger = createContextLogger('CronScheduler');

export const startCronJobs = () => {
  logger.info('Starting cron jobs');

  // Crawl feeds every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      logger.info('Starting scheduled feed crawl');
      const results = await crawlAllFeeds();
      logger.info('Scheduled feed crawl completed', results);
    } catch (error) {
      logger.error('Scheduled feed crawl failed', { error: error.message });
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Process AI enhancements every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('Starting scheduled AI processing');
      await processAIQueue();
    } catch (error) {
      logger.error('Scheduled AI processing failed', { error: error.message });
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Cleanup old logs daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting scheduled cleanup');
      await cleanupOldLogs();
    } catch (error) {
      logger.error('Scheduled cleanup failed', { error: error.message });
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  logger.info('Cron jobs started successfully');
};

const processAIQueue = async () => {
  try {
    const articlesNeedingAI = await getArticlesNeedingAI(20); // Process 20 at a time
    
    if (articlesNeedingAI.length === 0) {
      logger.debug('No articles need AI processing');
      return;
    }

    logger.info('Processing AI queue', { count: articlesNeedingAI.length });

    let processed = 0;
    let failed = 0;

    for (const articleData of articlesNeedingAI) {
      try {
        // Get full article data
        const articles = await selectRecords('articles', { id: articleData.id });
        
        if (articles.length > 0) {
          await processArticleAI(articles[0]);
          processed++;
        }
      } catch (error) {
        failed++;
        logger.warn('Failed to process AI for article', { 
          articleId: articleData.id,
          error: error.message 
        });
      }

      // Add small delay to avoid overwhelming the AI service
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('AI queue processing completed', { processed, failed });
  } catch (error) {
    logger.error('AI queue processing failed', { error: error.message });
    throw error;
  }
};

const cleanupOldLogs = async () => {
  try {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
    const { error } = await supabase
      .from('crawl_log')
      .delete()
      .lt('created_at', cutoffDate.toISOString());
    
    if (error) throw error;
    
    logger.info('Old logs cleaned up', { cutoffDate });
  } catch (error) {
    logger.error('Log cleanup failed', { error: error.message });
    throw error;
  }
};

export const stopCronJobs = () => {
  logger.info('Stopping cron jobs');
  cron.getTasks().forEach(task => task.stop());
  logger.info('All cron jobs stopped');
};