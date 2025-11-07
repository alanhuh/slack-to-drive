/**
 * Configuration Management
 * Loads and validates environment variables
 */

require('dotenv').config();

/**
 * Parse boolean from environment variable
 * @param {string} value - Environment variable value
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse integer from environment variable
 * @param {string} value - Environment variable value
 * @param {number} defaultValue - Default value if not set
 * @returns {number}
 */
function parseInteger(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse array from comma-separated string
 * @param {string} value - Comma-separated string
 * @param {Array} defaultValue - Default array if not set
 * @returns {Array}
 */
function parseArray(value, defaultValue = []) {
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

const config = {
  // Server
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInteger(process.env.PORT, 3000),
    logLevel: process.env.LOG_LEVEL || 'info',
  },

  // Slack
  slack: {
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    targetUserId: process.env.TARGET_USER_ID || null,
  },

  // Google Drive
  drive: {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './config/google-credentials.json',
  },

  // File Upload
  upload: {
    maxFileSizeMB: parseInteger(process.env.MAX_FILE_SIZE_MB, 50),
    maxFileSizeBytes: parseInteger(process.env.MAX_FILE_SIZE_MB, 50) * 1024 * 1024,
    allowedImageTypes: parseArray(process.env.ALLOWED_IMAGE_TYPES, [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
    ]),
    createDateFolders: parseBoolean(process.env.CREATE_DATE_FOLDERS, true),
  },

  // Retry
  retry: {
    maxAttempts: parseInteger(process.env.MAX_RETRY_ATTEMPTS, 3),
    delayMs: parseInteger(process.env.RETRY_DELAY_MS, 2000),
  },

  // Queue
  queue: {
    concurrency: parseInteger(process.env.QUEUE_CONCURRENCY, 3),
  },

  // Notifications
  notifications: {
    sendCompletion: parseBoolean(process.env.SEND_COMPLETION_MESSAGE, true),
    sendError: parseBoolean(process.env.SEND_ERROR_MESSAGE, true),
  },

  // Database
  database: {
    path: process.env.DATABASE_PATH || './data/uploads.db',
  },
};

/**
 * Validate required configuration
 * @throws {Error} If required config is missing
 */
function validateConfig() {
  const required = [
    { key: 'SLACK_SIGNING_SECRET', value: config.slack.signingSecret },
    { key: 'SLACK_BOT_TOKEN', value: config.slack.botToken },
    { key: 'GOOGLE_DRIVE_FOLDER_ID', value: config.drive.folderId },
  ];

  const missing = required.filter(({ value }) => !value);

  if (missing.length > 0) {
    const keys = missing.map(({ key }) => key).join(', ');
    throw new Error(`Missing required environment variables: ${keys}`);
  }

  // Validate Slack Bot Token format
  if (!config.slack.botToken.startsWith('xoxb-')) {
    throw new Error('SLACK_BOT_TOKEN must start with "xoxb-"');
  }

  // Validate file size
  if (config.upload.maxFileSizeMB <= 0 || config.upload.maxFileSizeMB > 1000) {
    throw new Error('MAX_FILE_SIZE_MB must be between 1 and 1000');
  }

  // Validate queue concurrency
  if (config.queue.concurrency < 1 || config.queue.concurrency > 10) {
    throw new Error('QUEUE_CONCURRENCY must be between 1 and 10');
  }
}

// Validate on load
validateConfig();

module.exports = config;
