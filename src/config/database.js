import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { createContextLogger } from './logger.js';

dotenv.config();

const logger = createContextLogger('Database');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  logger.error('Missing Supabase configuration', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey
  });
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

logger.info('Initializing Supabase client', {
  url: supabaseUrl.substring(0, 30) + '...',
  keyType: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'
});

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper functions for database operations
export const selectRecords = async (table, filters = {}, options = {}) => {
  try {
    let query = supabase.from(table).select('*');
    
    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    // Apply options
    if (options.orderBy) {
      query = query.order(options.orderBy.column, { 
        ascending: options.orderBy.ascending 
      });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error('Failed to select records', { 
      table, 
      filters, 
      error: error.message 
    });
    throw error;
  }
};

export const insertRecord = async (table, data) => {
  try {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) throw error;
    
    return result;
  } catch (error) {
    logger.error('Failed to insert record', { 
      table, 
      error: error.message 
    });
    throw error;
  }
};

export const updateRecord = async (table, id, updates) => {
  try {
    const { data: _data, error } = await supabase
      .from(table)
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    return _data;
  } catch (error) {
    logger.error('Failed to update record', { 
      table, 
      id, 
      error: error.message 
    });
    throw error;
  }
};

export const testConnection = async () => {
  try {
    logger.info('Testing database connection...');
    
    // Try a simple query with timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );
    
    const queryPromise = supabase
      .from('sources')
      .select('count')
      .limit(1);
    
  const { data: _data, error } = await Promise.race([queryPromise, timeoutPromise]);
    
    if (error) {
      logger.warn('Database connection test failed', { error: error.message });
      return false;
    }
    
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.warn('Database connection test error', { error: error.message });
    return false;
  }
};