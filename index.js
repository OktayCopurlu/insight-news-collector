import app from './src/app.js';
import { startCronJobs } from './src/scheduler/cronJobs.js';
import { testConnection } from './src/config/database.js';
import { createContextLogger } from './src/config/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const logger = createContextLogger('Server');
const PORT = process.env.PORT || 3000;

// Test database connection before starting server
const startServer = async () => {
  try {
    logger.info('Skipping database connection test - starting server directly');
    
    // Start the server
    const server = app.listen(PORT, () => {
      logger.info('Insight Feeder server started', {
        port: PORT,
        nodeVersion: process.versions.node,
        environment: process.env.NODE_ENV || 'development'
      });
      
      // Test database connection after server starts
    // Test database connection after server starts (non-blocking)
    setTimeout(async () => {
      logger.info('Testing database connection...');
      const isConnected = await testConnection();
      if (!isConnected) {
        logger.warn('Database connection failed. Please check your Supabase configuration.');
        logger.info('If tables are missing, please run the SQL migration manually in Supabase SQL Editor.');
      } else {
        logger.info('Database connection successful');
      }
    }, 1000);
    
      setTimeout(async () => {
        logger.info('Testing database connection...');
        const isConnected = await testConnection();
        if (isConnected) {
          logger.info('Database connection verified');
        } else {
          logger.warn('Database connection failed - check your Supabase configuration');
        }
      }, 2000);
    });
    
    // Start cron jobs
    startCronJobs();
    
    return server;
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Start the application
startServer().then(server => {
  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    logger.info('Received shutdown signal', { signal });
    
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };
  
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}).catch(error => {
  logger.error('Failed to start application', { error: error.message });
  process.exit(1);
});
  