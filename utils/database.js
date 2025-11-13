/**
 * SQLite Database Management
 * Handles upload history and tracking
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('./logger');

// Ensure data directory exists
const dataDir = path.dirname(config.database.path);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Initialize database connection
 */
const db = new Database(config.database.path, {
  verbose: config.server.nodeEnv === 'development' ? logger.debug : undefined,
});

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

/**
 * Create tables if not exists
 */
function initializeDatabase() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_file_id TEXT NOT NULL UNIQUE,
      slack_user_id TEXT NOT NULL,
      slack_user_name TEXT,
      channel_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      drive_file_id TEXT,
      drive_file_name TEXT,
      drive_file_url TEXT,
      drive_folder_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      uploaded_at DATETIME,
      CONSTRAINT status_check CHECK(status IN ('pending', 'processing', 'completed', 'failed'))
    );
  `;

  const createOAuthTokensTable = `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_type TEXT NOT NULL,
      expiry_date INTEGER NOT NULL,
      scope TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_slack_file_id ON uploads(slack_file_id);',
    'CREATE INDEX IF NOT EXISTS idx_status ON uploads(status);',
    'CREATE INDEX IF NOT EXISTS idx_created_at ON uploads(created_at);',
    'CREATE INDEX IF NOT EXISTS idx_user_id ON uploads(slack_user_id);',
  ];

  try {
    db.exec(createTableSQL);
    db.exec(createOAuthTokensTable);
    createIndexes.forEach(sql => db.exec(sql));
    logger.info('Database initialized successfully', { path: config.database.path });

    // Load OAuth tokens from environment variables if available
    loadOAuthTokensFromEnv();
  } catch (error) {
    logger.logError('Failed to initialize database', error);
    throw error;
  }
}

/**
 * Load OAuth tokens from environment variables into database
 * Environment variables are the source of truth and will always override database tokens
 */
function loadOAuthTokensFromEnv() {
  const { oauthTokens } = config;

  // Check if refresh token exists (required for OAuth)
  if (!oauthTokens.refreshToken) {
    logger.debug('No OAuth tokens in environment variables');
    return;
  }

  try {
    const tokens = {
      access_token: oauthTokens.accessToken,
      refresh_token: oauthTokens.refreshToken,
      token_type: oauthTokens.tokenType,
      expiry_date: oauthTokens.expiryDate,
      scope: oauthTokens.scope,
    };

    // Always load from environment variables if available
    // This ensures fresh tokens are used after redeployment
    saveOAuthTokens(tokens);
    logger.info('OAuth tokens loaded from environment variables');
  } catch (error) {
    logger.logError('Failed to load OAuth tokens from environment', error);
  }
}

// Initialize on load
initializeDatabase();

/**
 * Insert new upload record
 * @param {Object} data - Upload data
 * @returns {number} - Inserted row ID
 */
function insertUpload(data) {
  const stmt = db.prepare(`
    INSERT INTO uploads (
      slack_file_id,
      slack_user_id,
      slack_user_name,
      channel_id,
      original_filename,
      file_size,
      mime_type,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const info = stmt.run(
      data.slackFileId,
      data.slackUserId,
      data.slackUserName || null,
      data.channelId,
      data.originalFilename,
      data.fileSize || null,
      data.mimeType || null,
      data.status || 'pending'
    );

    logger.info('Upload record created', {
      id: info.lastInsertRowid,
      fileId: data.slackFileId,
    });

    return info.lastInsertRowid;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      logger.warn('Duplicate upload attempt', { fileId: data.slackFileId });
      return null;
    }
    logger.logError('Failed to insert upload record', error, { data });
    throw error;
  }
}

/**
 * Update upload record
 * @param {string} slackFileId - Slack file ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} - Success status
 */
function updateUpload(slackFileId, updates) {
  const allowedFields = [
    'status',
    'drive_file_id',
    'drive_file_name',
    'drive_file_url',
    'drive_folder_path',
    'error_message',
    'retry_count',
    'uploaded_at',
  ];

  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

  if (fields.length === 0) {
    logger.warn('No valid fields to update', { slackFileId, updates });
    return false;
  }

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);

  const stmt = db.prepare(`
    UPDATE uploads
    SET ${setClause}
    WHERE slack_file_id = ?
  `);

  try {
    const info = stmt.run(...values, slackFileId);

    if (info.changes > 0) {
      logger.info('Upload record updated', {
        fileId: slackFileId,
        fields,
      });
      return true;
    } else {
      logger.warn('No upload record found to update', { fileId: slackFileId });
      return false;
    }
  } catch (error) {
    logger.logError('Failed to update upload record', error, {
      fileId: slackFileId,
      updates,
    });
    throw error;
  }
}

/**
 * Get upload by Slack file ID
 * @param {string} slackFileId - Slack file ID
 * @returns {Object|null} - Upload record
 */
function getUpload(slackFileId) {
  const stmt = db.prepare('SELECT * FROM uploads WHERE slack_file_id = ?');

  try {
    return stmt.get(slackFileId) || null;
  } catch (error) {
    logger.logError('Failed to get upload record', error, { fileId: slackFileId });
    throw error;
  }
}

/**
 * Get uploads by status
 * @param {string} status - Status to filter by
 * @param {number} limit - Maximum number of records
 * @returns {Array} - Upload records
 */
function getUploadsByStatus(status, limit = 100) {
  const stmt = db.prepare(`
    SELECT * FROM uploads
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  try {
    return stmt.all(status, limit);
  } catch (error) {
    logger.logError('Failed to get uploads by status', error, { status, limit });
    throw error;
  }
}

/**
 * Get upload statistics
 * @returns {Object} - Statistics object
 */
function getStats() {
  const stmt = db.prepare(`
    SELECT
      status,
      COUNT(*) as count,
      SUM(file_size) as total_size
    FROM uploads
    GROUP BY status
  `);

  try {
    const results = stmt.all();
    const stats = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      totalSize: 0,
    };

    results.forEach(row => {
      stats[row.status] = row.count;
      stats.total += row.count;
      stats.totalSize += row.total_size || 0;
    });

    return stats;
  } catch (error) {
    logger.logError('Failed to get statistics', error);
    throw error;
  }
}

/**
 * Delete old records
 * @param {number} daysOld - Records older than this many days
 * @returns {number} - Number of deleted records
 */
function deleteOldRecords(daysOld = 30) {
  const stmt = db.prepare(`
    DELETE FROM uploads
    WHERE created_at < datetime('now', '-' || ? || ' days')
    AND status IN ('completed', 'failed')
  `);

  try {
    const info = stmt.run(daysOld);
    logger.info('Old records deleted', {
      count: info.changes,
      daysOld,
    });
    return info.changes;
  } catch (error) {
    logger.logError('Failed to delete old records', error, { daysOld });
    throw error;
  }
}

/**
 * Check if file already exists
 * @param {string} slackFileId - Slack file ID
 * @returns {boolean}
 */
function fileExists(slackFileId) {
  const stmt = db.prepare('SELECT 1 FROM uploads WHERE slack_file_id = ? LIMIT 1');

  try {
    return !!stmt.get(slackFileId);
  } catch (error) {
    logger.logError('Failed to check file existence', error, { fileId: slackFileId });
    throw error;
  }
}

/**
 * Get recent uploads for a user
 * @param {string} userId - Slack user ID
 * @param {number} limit - Maximum number of records
 * @returns {Array} - Upload records
 */
function getUserUploads(userId, limit = 10) {
  const stmt = db.prepare(`
    SELECT * FROM uploads
    WHERE slack_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  try {
    return stmt.all(userId, limit);
  } catch (error) {
    logger.logError('Failed to get user uploads', error, { userId, limit });
    throw error;
  }
}

/**
 * Save or update OAuth tokens
 * @param {Object} tokens - Token data from Google OAuth
 * @returns {number} - Row ID
 */
function saveOAuthTokens(tokens) {
  // Delete existing tokens (we only store one set)
  db.prepare('DELETE FROM oauth_tokens').run();

  const stmt = db.prepare(`
    INSERT INTO oauth_tokens (
      access_token,
      refresh_token,
      token_type,
      expiry_date,
      scope
    ) VALUES (?, ?, ?, ?, ?)
  `);

  try {
    const info = stmt.run(
      tokens.access_token,
      tokens.refresh_token,
      tokens.token_type || 'Bearer',
      tokens.expiry_date,
      tokens.scope || ''
    );

    logger.info('OAuth tokens saved', { id: info.lastInsertRowid });
    return info.lastInsertRowid;
  } catch (error) {
    logger.logError('Failed to save OAuth tokens', error);
    throw error;
  }
}

/**
 * Get OAuth tokens
 * @returns {Object|null} - Token data
 */
function getOAuthTokens() {
  const stmt = db.prepare('SELECT * FROM oauth_tokens ORDER BY created_at DESC LIMIT 1');

  try {
    const row = stmt.get();
    if (!row) return null;

    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      token_type: row.token_type,
      expiry_date: row.expiry_date,
      scope: row.scope,
    };
  } catch (error) {
    logger.logError('Failed to get OAuth tokens', error);
    throw error;
  }
}

/**
 * Check if OAuth tokens exist
 * @returns {boolean}
 */
function hasOAuthTokens() {
  const stmt = db.prepare('SELECT 1 FROM oauth_tokens LIMIT 1');

  try {
    return !!stmt.get();
  } catch (error) {
    logger.logError('Failed to check OAuth tokens', error);
    return false;
  }
}

/**
 * Close database connection
 */
function closeDatabase() {
  try {
    db.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.logError('Failed to close database', error);
  }
}

// Export functions
module.exports = {
  db,
  insertUpload,
  updateUpload,
  getUpload,
  getUploadsByStatus,
  getStats,
  deleteOldRecords,
  fileExists,
  getUserUploads,
  saveOAuthTokens,
  getOAuthTokens,
  hasOAuthTokens,
  closeDatabase,
};
