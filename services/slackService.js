/**
 * Slack Service
 * Handles Slack API interactions for file downloads and messaging
 */

const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize Slack Web API client
const slackClient = new WebClient(config.slack.botToken);

/**
 * Get file information from Slack
 * @param {string} fileId - Slack file ID
 * @returns {Promise<Object>} - File information
 */
async function getFileInfo(fileId) {
  try {
    logger.logApiCall('slack', 'files.info', { fileId });

    const response = await slackClient.files.info({
      file: fileId,
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    const file = response.file;

    logger.info('Retrieved file info from Slack', {
      fileId: file.id,
      filename: file.name,
      mimeType: file.mimetype,
      size: file.size,
      user: file.user,
    });

    return {
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      filetype: file.filetype,
      size: file.size,
      urlPrivate: file.url_private,
      urlPrivateDownload: file.url_private_download,
      user: file.user,
      created: file.created,
      channels: file.channels || [],
    };
  } catch (error) {
    logger.logError('Failed to get file info from Slack', error, { fileId });
    throw error;
  }
}

/**
 * Download file from Slack as stream
 * @param {string} downloadUrl - Slack private download URL
 * @returns {Promise<Stream>} - Readable stream
 */
async function downloadFileStream(downloadUrl) {
  try {
    logger.logApiCall('slack', 'download', { url: downloadUrl });

    const response = await axios.get(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${config.slack.botToken}`,
      },
      responseType: 'stream',
      timeout: 30000, // 30 seconds
    });

    logger.debug('File download stream created', {
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
    });

    return response.data;
  } catch (error) {
    logger.logError('Failed to download file from Slack', error, {
      url: downloadUrl,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * Download file from Slack as buffer (for Vision API analysis)
 * @param {string} downloadUrl - Slack private download URL
 * @returns {Promise<Buffer>} - File buffer
 */
async function downloadFile(downloadUrl) {
  try {
    logger.logApiCall('slack', 'downloadBuffer', { url: downloadUrl });

    const response = await axios.get(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${config.slack.botToken}`,
      },
      responseType: 'arraybuffer',
      timeout: 30000, // 30 seconds
    });

    logger.debug('File downloaded as buffer', {
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
    });

    return Buffer.from(response.data);
  } catch (error) {
    logger.logError('Failed to download file buffer from Slack', error, {
      url: downloadUrl,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * Get user information
 * @param {string} userId - Slack user ID
 * @returns {Promise<Object>} - User information
 */
async function getUserInfo(userId) {
  try {
    logger.logApiCall('slack', 'users.info', { userId });

    const response = await slackClient.users.info({
      user: userId,
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    const user = response.user;

    return {
      id: user.id,
      name: user.name,
      realName: user.real_name,
      displayName: user.profile?.display_name,
      email: user.profile?.email,
    };
  } catch (error) {
    logger.logError('Failed to get user info from Slack', error, { userId });
    // Don't throw - user info is not critical
    return {
      id: userId,
      name: 'Unknown User',
    };
  }
}

/**
 * Send message to Slack channel
 * @param {string} channelId - Channel ID
 * @param {string} text - Message text
 * @param {Array} blocks - Slack blocks (optional)
 * @returns {Promise<Object>} - Message response
 */
async function sendMessage(channelId, text, blocks = null) {
  try {
    logger.logApiCall('slack', 'chat.postMessage', { channelId });

    const params = {
      channel: channelId,
      text: text,
    };

    if (blocks) {
      params.blocks = blocks;
    }

    const response = await slackClient.chat.postMessage(params);

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    logger.info('Message sent to Slack', {
      channelId,
      messageTs: response.ts,
    });

    return {
      ts: response.ts,
      channel: response.channel,
    };
  } catch (error) {
    logger.logError('Failed to send message to Slack', error, {
      channelId,
      text,
    });
    throw error;
  }
}

/**
 * Send upload completion message
 * @param {string} channelId - Channel ID
 * @param {Object} uploadData - Upload data
 * @returns {Promise}
 */
async function sendCompletionMessage(channelId, uploadData) {
  if (!config.notifications.sendCompletion) {
    return;
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *File uploaded to Google Drive*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Filename:*\n${uploadData.originalFilename}`,
        },
        {
          type: 'mrkdwn',
          text: `*Size:*\n${formatFileSize(uploadData.fileSize)}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${uploadData.driveFileUrl}|View in Drive>`,
      },
    },
  ];

  try {
    await sendMessage(
      channelId,
      `File "${uploadData.originalFilename}" uploaded to Google Drive`,
      blocks
    );
  } catch (error) {
    // Don't throw - notification failure shouldn't fail the upload
    logger.warn('Failed to send completion message', {
      channelId,
      error: error.message,
    });
  }
}

/**
 * Send upload error message
 * @param {string} channelId - Channel ID
 * @param {Object} uploadData - Upload data
 * @param {Error} error - Error object
 * @returns {Promise}
 */
async function sendErrorMessage(channelId, uploadData, error) {
  if (!config.notifications.sendError) {
    return;
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *Failed to upload file to Google Drive*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Filename:*\n${uploadData.originalFilename}`,
        },
        {
          type: 'mrkdwn',
          text: `*Error:*\n${error.message}`,
        },
      ],
    },
  ];

  try {
    await sendMessage(
      channelId,
      `Failed to upload "${uploadData.originalFilename}" to Google Drive: ${error.message}`,
      blocks
    );
  } catch (err) {
    logger.warn('Failed to send error message', {
      channelId,
      error: err.message,
    });
  }
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted size
 */
function formatFileSize(bytes) {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Send typing indicator
 * @param {string} channelId - Channel ID
 * @returns {Promise}
 */
async function sendTyping(channelId) {
  try {
    // Note: Slack deprecated the typing indicator API
    // This is kept for future reference if they bring it back
    logger.debug('Typing indicator requested', { channelId });
  } catch (error) {
    logger.debug('Failed to send typing indicator', { error: error.message });
  }
}

/**
 * Update message
 * @param {string} channelId - Channel ID
 * @param {string} messageTs - Message timestamp
 * @param {string} text - New message text
 * @param {Array} blocks - New blocks (optional)
 * @returns {Promise}
 */
async function updateMessage(channelId, messageTs, text, blocks = null) {
  try {
    logger.logApiCall('slack', 'chat.update', { channelId, messageTs });

    const params = {
      channel: channelId,
      ts: messageTs,
      text: text,
    };

    if (blocks) {
      params.blocks = blocks;
    }

    const response = await slackClient.chat.update(params);

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    logger.info('Message updated in Slack', {
      channelId,
      messageTs: response.ts,
    });

    return response;
  } catch (error) {
    logger.logError('Failed to update message in Slack', error, {
      channelId,
      messageTs,
    });
    throw error;
  }
}

/**
 * Send classification confirmation message
 * @param {string} channelId - Channel ID
 * @param {Object} classification - Classification result
 * @param {string} fileId - File ID
 * @returns {Promise}
 */
async function sendClassificationMessage(channelId, classification, fileId) {
  try {
    const messageBuilder = require('./messageBuilder');
    const message = messageBuilder.buildClassificationBlocks(classification, fileId);

    logger.logApiCall('slack', 'chat.postMessage', {
      channelId,
      category: classification.category
    });

    const params = {
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
    };

    // Add metadata if supported
    if (message.metadata) {
      params.metadata = message.metadata;
    }

    const response = await slackClient.chat.postMessage(params);

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    logger.info('Classification message sent to Slack', {
      channelId,
      messageTs: response.ts,
      category: classification.category,
      confidence: classification.confidence,
    });

    return {
      ts: response.ts,
      channel: response.channel,
    };
  } catch (error) {
    logger.logError('Failed to send classification message to Slack', error, {
      channelId,
      fileId,
    });
    throw error;
  }
}

/**
 * Test Slack connection
 * @returns {Promise<Object>} - Auth test response
 */
async function testConnection() {
  try {
    const response = await slackClient.auth.test();

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    logger.info('Slack connection test successful', {
      team: response.team,
      user: response.user,
      botId: response.bot_id,
    });

    return {
      ok: true,
      team: response.team,
      user: response.user,
      teamId: response.team_id,
      userId: response.user_id,
      botId: response.bot_id,
    };
  } catch (error) {
    logger.logError('Slack connection test failed', error);
    throw error;
  }
}

module.exports = {
  slackClient,
  getFileInfo,
  downloadFileStream,
  downloadFile,
  getUserInfo,
  sendMessage,
  sendCompletionMessage,
  sendErrorMessage,
  sendClassificationMessage,
  sendTyping,
  updateMessage,
  formatFileSize,
  testConnection,
};
