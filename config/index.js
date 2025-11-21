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
    credentialsBase64: process.env.GOOGLE_CREDENTIALS_BASE64 || null,
    // OAuth 2.0 (replaces Service Account)
    oauth: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${parseInteger(process.env.PORT, 3000)}/oauth/callback`,
    },
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

  // Notion (Optional)
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    uploadLogDbId: process.env.NOTION_UPLOAD_LOG_DB_ID || '',
    classificationLogDbId: process.env.NOTION_CLASSIFICATION_LOG_DB_ID || '',
    enabled: parseBoolean(process.env.ENABLE_NOTION_LOGGING, false),
    classificationLoggingEnabled: parseBoolean(process.env.ENABLE_CLASSIFICATION_LOGGING, false),
  },

  // Google Cloud Vision API (Optional)
  vision: {
    apiKey: process.env.GOOGLE_VISION_API_KEY || null,
    credentialsBase64: process.env.GOOGLE_VISION_CREDENTIALS_BASE64 || null,
    credentialsPath: process.env.GOOGLE_VISION_CREDENTIALS_PATH || null,
    enabled: parseBoolean(process.env.ENABLE_VISION_API, false),
  },

  // AI Classification
  classification: {
    enabled: parseBoolean(process.env.ENABLE_AI_CLASSIFICATION, false),
    confidenceThreshold: parseFloat(process.env.AI_CONFIDENCE_THRESHOLD) || 0.7,
    categories: parseArray(process.env.CLASSIFICATION_CATEGORIES, [
      '캐릭터 일러스트 (단독)',
      '일러스트 (단체)',
      'UI / 화면',
      '게임 스크린샷',
      '기타'
    ]),
    rootFolderName: process.env.CLASSIFICATION_ROOT_FOLDER_NAME || 'AI_분류',
    rootFolderId: process.env.CLASSIFICATION_ROOT_FOLDER_ID || null, // If null, uses drive.folderId as parent
  },

  // Context Collection
  context: {
    messageLim: parseInteger(process.env.CONTEXT_MESSAGE_LIMIT, 2),
    preferThread: parseBoolean(process.env.PREFER_THREAD_CONTEXT, true),
    enableKeywordMatching: parseBoolean(process.env.ENABLE_KEYWORD_MATCHING, true),
  },

  // Learning & Feedback
  learning: {
    enabled: parseBoolean(process.env.ENABLE_LEARNING_TRACKER, true),
    reportInterval: parseInteger(process.env.LEARNING_REPORT_INTERVAL, 50),
    feedbackStorage: process.env.FEEDBACK_STORAGE || 'database', // 'database', 'notion', 'both'
  },

  // OAuth Tokens (Optional - for persisting across deployments)
  oauthTokens: {
    accessToken: process.env.OAUTH_ACCESS_TOKEN || '',
    refreshToken: process.env.OAUTH_REFRESH_TOKEN || '',
    tokenType: process.env.OAUTH_TOKEN_TYPE || 'Bearer',
    expiryDate: process.env.OAUTH_EXPIRY_DATE ? parseInt(process.env.OAUTH_EXPIRY_DATE, 10) : null,
    scope: process.env.OAUTH_SCOPE || '',
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
    { key: 'GOOGLE_CLIENT_ID', value: config.drive.oauth.clientId },
    { key: 'GOOGLE_CLIENT_SECRET', value: config.drive.oauth.clientSecret },
  ];

  const missing = required.filter(({ value }) => !value);

  if (missing.length > 0) {
    const keys = missing.map(({ key }) => key).join(', ');
    const error = new Error(`Missing required environment variables: ${keys}`);
    console.error('\n❌ CONFIG VALIDATION FAILED:');
    console.error(`Missing required environment variables: ${keys}`);
    console.error('\nPlease set these variables in your .env file or Render dashboard.\n');
    throw error;
  }

  // Validate Slack Bot Token format
  if (!config.slack.botToken.startsWith('xoxb-')) {
    const error = new Error('SLACK_BOT_TOKEN must start with "xoxb-"');
    console.error('\n❌ CONFIG VALIDATION FAILED:');
    console.error('SLACK_BOT_TOKEN must start with "xoxb-"');
    console.error(`Current value starts with: ${config.slack.botToken.substring(0, 10)}...\n`);
    throw error;
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
