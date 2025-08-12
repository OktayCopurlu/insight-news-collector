import Parser from 'rss-parser';
import axios from 'axios';
import { createContextLogger } from '../config/logger.js';
import { generateContentHash } from '../utils/helpers.js';

const logger = createContextLogger('FeedParser');

const parser = new Parser({
  timeout: parseInt(process.env.FETCH_TIMEOUT_MS) || 15000,
  headers: {
    'User-Agent': process.env.FEED_USER_AGENT || 'InsightFeeder/1.0'
  }
});

export const parseFeed = async (feedUrl, options = {}) => {
  try {
    logger.info('Parsing feed', { feedUrl });

    const axiosConfig = {
      timeout: parseInt(process.env.FETCH_TIMEOUT_MS) || 15000,
      headers: {
        'User-Agent': process.env.FEED_USER_AGENT || 'InsightFeeder/1.0'
      }
    };

    // Add conditional headers if available
    if (options.lastEtag) {
      axiosConfig.headers['If-None-Match'] = options.lastEtag;
    }
    if (options.lastModified) {
      axiosConfig.headers['If-Modified-Since'] = options.lastModified;
    }

    const response = await axios.get(feedUrl, axiosConfig);
    
    // Check if content was modified
    if (response.status === 304) {
      logger.info('Feed not modified', { feedUrl });
      return { items: [], notModified: true };
    }

    const feed = await parser.parseString(response.data);
    
    const items = feed.items.map(item => ({
      title: item.title || '',
      url: item.link || item.guid || '',
      snippet: item.contentSnippet || item.summary || item.description || '',
      published_at: item.pubDate ? new Date(item.pubDate) : new Date(),
      language: detectLanguage(item.title, item.contentSnippet),
      content_hash: generateContentHash(item.title, item.contentSnippet)
    }));

    logger.info('Feed parsed successfully', { 
      feedUrl, 
      itemCount: items.length,
      etag: response.headers.etag,
      lastModified: response.headers['last-modified']
    });

    return {
      items,
      etag: response.headers.etag,
      lastModified: response.headers['last-modified'],
      notModified: false
    };

  } catch (error) {
    if (error.response?.status === 304) {
      return { items: [], notModified: true };
    }
    
    logger.error('Failed to parse feed', { 
      feedUrl, 
      error: error.message,
      status: error.response?.status 
    });
    throw error;
  }
};

export const validateFeedUrl = async (feedUrl) => {
  try {
    const response = await axios.head(feedUrl, {
      timeout: 5000,
      headers: {
        'User-Agent': process.env.FEED_USER_AGENT || 'InsightFeeder/1.0'
      }
    });

    const contentType = response.headers['content-type'] || '';
    const isValidFeed = contentType.includes('xml') || 
                       contentType.includes('rss') || 
                       contentType.includes('atom');

    return {
      valid: isValidFeed,
      contentType,
      status: response.status
    };
  } catch (error) {
    logger.warn('Feed validation failed', { feedUrl, error: error.message });
    return {
      valid: false,
      error: error.message
    };
  }
};

const detectLanguage = (title = '', content = '') => {
  const text = `${title} ${content}`.toLowerCase();
  
  // Simple language detection based on common words
  const patterns = {
    'en': /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/g,
    'es': /\b(el|la|los|las|y|o|pero|en|con|por|para|de)\b/g,
    'fr': /\b(le|la|les|et|ou|mais|dans|sur|avec|par|pour|de)\b/g,
    'de': /\b(der|die|das|und|oder|aber|in|auf|mit|von|für)\b/g,
    'it': /\b(il|la|lo|gli|le|e|o|ma|in|su|con|da|per|di)\b/g
  };

  let maxMatches = 0;
  let detectedLang = 'en';

  Object.entries(patterns).forEach(([lang, pattern]) => {
    const matches = (text.match(pattern) || []).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      detectedLang = lang;
    }
  });

  return detectedLang;
};

export const extractFeedMetadata = async (feedUrl) => {
  try {
    const feed = await parser.parseURL(feedUrl);
    
    return {
      title: feed.title || '',
      description: feed.description || '',
      link: feed.link || '',
      language: feed.language || detectLanguage(feed.title, feed.description),
      lastBuildDate: feed.lastBuildDate ? new Date(feed.lastBuildDate) : null,
      itemCount: feed.items?.length || 0
    };
  } catch (error) {
    logger.error('Failed to extract feed metadata', { feedUrl, error: error.message });
    throw error;
  }
};