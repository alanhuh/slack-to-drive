/**
 * Slack Context Helper
 *
 * Collects message context from Slack for better classification
 * - Thread messages
 * - User's recent messages around the upload time
 */

const logger = require('../../utils/logger');
const config = require('../../config');

class SlackContextHelper {
  constructor(slackWebClient) {
    this.client = slackWebClient;
  }

  /**
   * Collect context for an image upload
   * @param {Object} fileInfo - Slack file information
   * @returns {Object} Context data
   */
  async collectContext(fileInfo) {
    const { channels, user, timestamp, thread_ts } = fileInfo;
    const channelId = channels && channels[0];

    if (!channelId) {
      logger.warn('No channel ID found for file', { fileId: fileInfo.id });
      return { type: 'none', messages: [] };
    }

    try {
      // Priority 1: Thread context (if file is in a thread)
      if (thread_ts && config.context.preferThread) {
        const threadContext = await this.getThreadContext(channelId, thread_ts);
        if (threadContext.messages.length > 0) {
          return {
            type: 'thread',
            messages: threadContext.messages,
            summary: this.summarizeMessages(threadContext.messages),
          };
        }
      }

      // Priority 2: User's recent messages
      const userContext = await this.getUserRecentMessages(channelId, user, timestamp);
      return {
        type: 'user_messages',
        messages: userContext.messages,
        summary: this.summarizeMessages(userContext.messages),
      };
    } catch (error) {
      logger.logError('Failed to collect Slack context', error, {
        channelId,
        userId: user,
      });
      return { type: 'error', messages: [], error: error.message };
    }
  }

  /**
   * Get all messages in a thread
   * @param {string} channelId - Channel ID
   * @param {string} threadTs - Thread timestamp
   * @returns {Object} Thread messages
   */
  async getThreadContext(channelId, threadTs) {
    try {
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 10, // Get up to 10 thread messages
      });

      const messages = result.messages
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(msg => ({
          user: msg.user,
          text: msg.text,
          ts: msg.ts,
        }));

      logger.debug('Thread context collected', {
        channelId,
        threadTs,
        messageCount: messages.length,
      });

      return { messages };
    } catch (error) {
      logger.warn('Failed to get thread context', {
        channelId,
        threadTs,
        error: error.message,
      });
      return { messages: [] };
    }
  }

  /**
   * Get user's recent messages around a timestamp
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {string} timestamp - Reference timestamp
   * @returns {Object} User messages
   */
  async getUserRecentMessages(channelId, userId, timestamp) {
    try {
      const limit = config.context.messageLim || 2;
      const ts = parseFloat(timestamp);

      // Get messages before and after the file upload
      const [before, after] = await Promise.all([
        this.getMessagesBeforeTimestamp(channelId, userId, ts, limit),
        this.getMessagesAfterTimestamp(channelId, userId, ts, limit),
      ]);

      const messages = [...before, ...after]
        .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
        .slice(0, limit * 2);

      logger.debug('User context collected', {
        channelId,
        userId,
        messageCount: messages.length,
      });

      return { messages };
    } catch (error) {
      logger.warn('Failed to get user recent messages', {
        channelId,
        userId,
        error: error.message,
      });
      return { messages: [] };
    }
  }

  /**
   * Get messages before a timestamp
   */
  async getMessagesBeforeTimestamp(channelId, userId, timestamp, limit) {
    try {
      const result = await this.client.conversations.history({
        channel: channelId,
        latest: timestamp.toString(),
        limit: 20, // Fetch more to filter by user
      });

      return result.messages
        .filter(msg => msg.user === userId && msg.text && msg.text.trim().length > 0)
        .slice(0, limit)
        .map(msg => ({
          user: msg.user,
          text: msg.text,
          ts: msg.ts,
        }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get messages after a timestamp
   */
  async getMessagesAfterTimestamp(channelId, userId, timestamp, limit) {
    try {
      const result = await this.client.conversations.history({
        channel: channelId,
        oldest: timestamp.toString(),
        limit: 20,
      });

      return result.messages
        .filter(msg => msg.user === userId && msg.text && msg.text.trim().length > 0)
        .slice(0, limit)
        .map(msg => ({
          user: msg.user,
          text: msg.text,
          ts: msg.ts,
        }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Summarize messages into a single string
   * @param {Array} messages - Array of messages
   * @returns {string} Summary
   */
  summarizeMessages(messages) {
    if (!messages || messages.length === 0) {
      return '';
    }

    return messages
      .map(msg => msg.text)
      .join(' ')
      .slice(0, 500); // Limit to 500 chars
  }
}

module.exports = SlackContextHelper;
