/**
 * Winston Logger Configuration
 * Provides structured logging with file rotation and console output
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom log format
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/**
 * Console format for development
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    if (metaStr) {
      msg += `\n${metaStr}`;
    }

    return msg;
  })
);

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: config.server.logLevel,
  format: logFormat,
  defaultMeta: { service: 'slack-to-drive' },
  transports: [
    // Error log file - only errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),

    // Combined log file - all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true,
    }),
  ],

  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10485760,
      maxFiles: 5,
    }),
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10485760,
      maxFiles: 5,
    }),
  ],
});

/**
 * Add console output in development mode
 */
if (config.server.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

/**
 * Create child logger with additional context
 * @param {Object} meta - Additional metadata
 * @returns {winston.Logger}
 */
logger.child = (meta) => {
  return logger.child(meta);
};

/**
 * Log upload event with structured data
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} data - Upload data
 */
logger.logUpload = (level, message, data = {}) => {
  const {
    fileId,
    userId,
    channelId,
    filename,
    fileSize,
    driveFileId,
    error,
    ...extra
  } = data;

  logger.log(level, message, {
    fileId,
    userId,
    channelId,
    filename,
    fileSize,
    driveFileId,
    error: error ? error.message : undefined,
    stack: error ? error.stack : undefined,
    ...extra,
  });
};

/**
 * Log Slack event
 * @param {string} message - Log message
 * @param {Object} event - Slack event data
 */
logger.logSlackEvent = (message, event = {}) => {
  logger.info(message, {
    eventType: event.type,
    eventId: event.event_id,
    userId: event.user_id,
    channelId: event.channel_id,
    fileId: event.file_id,
  });
};

/**
 * Log API call
 * @param {string} api - API name (slack, drive)
 * @param {string} method - API method
 * @param {Object} data - Additional data
 */
logger.logApiCall = (api, method, data = {}) => {
  logger.debug(`${api} API call: ${method}`, data);
};

/**
 * Log error with full context
 * @param {string} message - Error message
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
logger.logError = (message, error, context = {}) => {
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    code: error.code,
    ...context,
  });
};

module.exports = logger;
