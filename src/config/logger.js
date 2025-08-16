import dotenv from "dotenv";

dotenv.config();

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

const formatMessage = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const metaString =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaString}`;
};

const logger = {
  debug: (message, meta) => {
    if (currentLogLevel <= LOG_LEVELS.debug) {
      console.log(formatMessage("debug", message, meta));
    }
  },

  info: (message, meta) => {
    if (currentLogLevel <= LOG_LEVELS.info) {
      console.log(formatMessage("info", message, meta));
    }
  },

  warn: (message, meta) => {
    if (currentLogLevel <= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message, meta));
    }
  },

  error: (message, meta) => {
    if (currentLogLevel <= LOG_LEVELS.error) {
      console.error(formatMessage("error", message, meta));
    }
  },
};

export const createContextLogger = (context) => ({
  debug: (message, meta) => logger.debug(message, { context, ...meta }),
  info: (message, meta) => logger.info(message, { context, ...meta }),
  warn: (message, meta) => logger.warn(message, { context, ...meta }),
  error: (message, meta) => logger.error(message, { context, ...meta }),
});
