import dotenv from 'dotenv';
import { createContextLogger } from '../config/logger.js';

dotenv.config();

const logger = createContextLogger('AuthMiddleware');

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  const expectedToken = process.env.EDGE_TOKEN;
  
  if (!expectedToken) {
    logger.warn('EDGE_TOKEN not configured, skipping authentication');
    return next();
  }

  if (token !== expectedToken) {
    logger.warn('Invalid token provided', { 
      providedToken: token.substring(0, 10) + '...' 
    });
    return res.status(403).json({
      success: false,
      error: 'Invalid token'
    });
  }

  next();
};

export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token) {
    const expectedToken = process.env.EDGE_TOKEN;
    
    if (expectedToken && token === expectedToken) {
      req.authenticated = true;
    } else {
      req.authenticated = false;
    }
  } else {
    req.authenticated = false;
  }
  
  next();
};

export const requireAuth = (req, res, next) => {
  if (!req.authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};