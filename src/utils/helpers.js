import crypto from 'crypto';

export const generateContentHash = (title = '', snippet = '') => {
  const content = `${title}${snippet}`.trim();
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
};

export const generateUUID = () => {
  return crypto.randomUUID();
};

export const sanitizeText = (text) => {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .substring(0, 5000); // Limit length
};

export const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

export const extractDomain = (url) => {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return null;
  }
};

export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const retry = async (fn, maxAttempts = 3, delay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      await sleep(delay * attempt);
    }
  }
};

export const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const formatDate = (date) => {
  if (!date) return null;
  
  try {
    return new Date(date).toISOString();
  } catch (_) {
    return null;
  }
};

export const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
};

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  
  return text.substring(0, maxLength - 3) + '...';
};

export const normalizeLanguageCode = (lang) => {
  if (!lang) return 'en';
  
  // Convert to lowercase and take first 2 characters
  const normalized = lang.toLowerCase().substring(0, 2);
  
  // Map common variations
  const langMap = {
    'en': 'en',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'it': 'it',
    'pt': 'pt',
    'ru': 'ru',
    'zh': 'zh',
    'ja': 'ja',
    'ko': 'ko',
    'ar': 'ar'
  };
  
  return langMap[normalized] || 'en';
};

export const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();
  
  return (key) => {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old requests
    if (requests.has(key)) {
      requests.set(key, requests.get(key).filter(time => time > windowStart));
    } else {
      requests.set(key, []);
    }
    
    const requestTimes = requests.get(key);
    
    if (requestTimes.length >= maxRequests) {
      return false; // Rate limit exceeded
    }
    
    requestTimes.push(now);
    return true; // Request allowed
  };
};