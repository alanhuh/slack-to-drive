/**
 * Notion Upload Logger
 * Logs all Slack to Drive upload activities to Notion database
 */

const { Client } = require('@notionhq/client');
const config = require('../config');
const logger = require('../utils/logger');

class NotionLogger {
  constructor() {
    // Only initialize if API key is provided
    if (config.notion.apiKey) {
      this.client = new Client({
        auth: config.notion.apiKey,
        timeoutMs: 60000, // 1 minute timeout
      });
      this.databaseId = config.notion.uploadLogDbId;
    } else {
      this.client = null;
      this.databaseId = null;
    }
  }

  /**
   * Check if Notion logging is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return config.notion.enabled && this.client !== null && this.databaseId !== null;
  }

  /**
   * Create upload log database (run once during setup)
   * @param {string} parentPageId - Parent Notion page ID
   * @returns {Promise<string>} - Created database ID
   */
  async createUploadLogDatabase(parentPageId) {
    if (!this.client) {
      throw new Error('Notion client not initialized. Check NOTION_API_KEY');
    }

    try {
      logger.info('Creating Notion upload log database...', { parentPageId });

      const database = await this.client.databases.create({
        parent: {
          type: 'page_id',
          page_id: parentPageId,
        },
        title: [
          {
            type: 'text',
            text: {
              content: '📤 Slack Upload Log',
            },
          },
        ],
        properties: {
          'Upload ID': {
            title: {},
          },
          'Timestamp': {
            date: {},
          },
          'File Name': {
            rich_text: {},
          },
          'File Size (MB)': {
            number: {
              format: 'number',
            },
          },
          'MIME Type': {
            select: {},
          },
          'Slack User ID': {
            rich_text: {},
          },
          'Slack User Name': {
            rich_text: {},
          },
          'Channel ID': {
            rich_text: {},
          },
          'Drive File ID': {
            rich_text: {},
          },
          'Drive URL': {
            url: {},
          },
          'Status': {
            select: {
              options: [
                { name: 'Pending', color: 'yellow' },
                { name: 'Processing', color: 'blue' },
                { name: 'Completed', color: 'green' },
                { name: 'Failed', color: 'red' },
              ],
            },
          },
          'Error Message': {
            rich_text: {},
          },
          'Retry Count': {
            number: {
              format: 'number',
            },
          },
          'Processing Time (ms)': {
            number: {
              format: 'number',
            },
          },
        },
      });

      logger.info('Upload log database created successfully', {
        id: database.id,
        url: `https://notion.so/${database.id.replace(/-/g, '')}`,
      });

      console.log('\n✅ Notion 데이터베이스가 생성되었습니다!');
      console.log(`📊 Database ID: ${database.id}`);
      console.log(`🔗 URL: https://notion.so/${database.id.replace(/-/g, '')}`);
      console.log('\n.env 파일에 다음 내용을 추가하세요:');
      console.log(`NOTION_UPLOAD_LOG_DB_ID=${database.id}\n`);

      return database.id;
    } catch (error) {
      logger.logError('Failed to create Notion database', error, { parentPageId });
      throw error;
    }
  }

  /**
   * Log new upload to Notion
   * @param {Object} uploadData - Upload information
   * @returns {Promise<string|null>} - Created page ID or null on failure
   */
  async logUpload(uploadData) {
    if (!this.isEnabled()) {
      logger.debug('Notion logging disabled, skipping log');
      return null;
    }

    try {
      const {
        slackFileId,
        slackUserId,
        slackUserName,
        channelId,
        filename,
        fileSize,
        mimeType,
        status = 'Pending',
      } = uploadData;

      const page = await this.client.pages.create({
        parent: { database_id: this.databaseId },
        properties: {
          'Upload ID': {
            title: [{ text: { content: slackFileId || 'unknown' } }],
          },
          'Timestamp': {
            date: { start: new Date().toISOString() },
          },
          'File Name': {
            rich_text: [{ text: { content: this.truncate(filename, 2000) } }],
          },
          'File Size (MB)': {
            number: fileSize ? Number((fileSize / (1024 * 1024)).toFixed(2)) : 0,
          },
          'MIME Type': {
            select: { name: this.truncate(mimeType || 'unknown', 100) },
          },
          'Slack User ID': {
            rich_text: [{ text: { content: slackUserId || '' } }],
          },
          'Slack User Name': {
            rich_text: [{ text: { content: this.truncate(slackUserName || 'Unknown', 2000) } }],
          },
          'Channel ID': {
            rich_text: [{ text: { content: channelId || '' } }],
          },
          'Status': {
            select: { name: status },
          },
          'Retry Count': {
            number: 0,
          },
        },
      });

      logger.info('Upload logged to Notion', {
        pageId: page.id,
        fileId: slackFileId,
        filename,
      });

      return page.id;
    } catch (error) {
      logger.logError('Failed to log upload to Notion', error, uploadData);
      // Don't fail the main process
      return null;
    }
  }

  /**
   * Update upload status in Notion using REST API
   * @param {string} pageId - Notion page ID
   * @param {string} slackFileId - Slack file ID (for logging)
   * @param {Object} updates - Fields to update
   * @returns {Promise<boolean>} - Success status
   */
  async updateUploadStatus(pageId, slackFileId, updates) {
    if (!this.isEnabled()) {
      logger.debug('Notion logging disabled, skipping update');
      return false;
    }

    if (!pageId) {
      logger.debug('No Notion page ID provided, skipping update');
      return false;
    }

    try {
      const properties = {};

      // Status update
      if (updates.status) {
        properties['Status'] = {
          select: { name: updates.status },
        };
      }

      // Drive file ID
      if (updates.driveFileId) {
        properties['Drive File ID'] = {
          rich_text: [{ text: { content: updates.driveFileId } }],
        };
      }

      // Drive URL
      if (updates.driveUrl) {
        properties['Drive URL'] = {
          url: updates.driveUrl,
        };
      }

      // Error message
      if (updates.errorMessage) {
        properties['Error Message'] = {
          rich_text: [{ text: { content: this.truncate(updates.errorMessage, 2000) } }],
        };
      }

      // Retry count
      if (updates.retryCount !== undefined) {
        properties['Retry Count'] = {
          number: updates.retryCount,
        };
      }

      // Processing time
      if (updates.processingTimeMs !== undefined) {
        properties['Processing Time (ms)'] = {
          number: updates.processingTimeMs,
        };
      }

      // Use REST API to update page
      await this._updatePageViaRestApi(pageId, properties);

      logger.info('Notion upload status updated', {
        pageId,
        fileId: slackFileId,
        updates: Object.keys(updates),
      });

      return true;
    } catch (error) {
      logger.logError('Failed to update Notion status', error, {
        pageId,
        fileId: slackFileId,
        updates,
      });
      // Don't fail the main process
      return false;
    }
  }

  /**
   * Update Notion page using direct REST API call
   * @param {string} pageId - Notion page ID
   * @param {Object} properties - Properties to update
   * @returns {Promise<Object>} - Updated page object
   * @private
   */
  async _updatePageViaRestApi(pageId, properties) {
    const https = require('https');

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ properties });

      const options = {
        hostname: 'api.notion.com',
        path: `/v1/pages/${pageId}`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${config.notion.apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(responseData);
              resolve(parsed);
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error.message}`));
            }
          } else {
            try {
              const errorData = JSON.parse(responseData);
              reject(new Error(`Notion API error (${res.statusCode}): ${errorData.message || responseData}`));
            } catch {
              reject(new Error(`Notion API error (${res.statusCode}): ${responseData}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Truncate text to fit Notion limits
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length (default 2000)
   * @returns {string} - Truncated text
   */
  truncate(text, maxLength = 2000) {
    if (!text) return '';
    const str = String(text);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Test Notion connection
   * @returns {Promise<boolean>} - Connection status
   */
  async testConnection() {
    if (!this.isEnabled()) {
      logger.info('Notion logging is disabled');
      return true; // Not an error if disabled
    }

    try {
      const database = await this.client.databases.retrieve({
        database_id: this.databaseId,
      });

      logger.info('Notion connection successful', {
        id: database.id,
        title: database.title[0]?.plain_text,
      });

      return true;
    } catch (error) {
      logger.logError('Notion connection test failed', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new NotionLogger();
