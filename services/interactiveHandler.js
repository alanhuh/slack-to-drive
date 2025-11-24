/**
 * Interactive Handler
 *
 * Handles Slack Interactive Components:
 * - Button clicks
 * - Select menu selections
 * - Modal submissions
 */

const organizationAgent = require('./agents/organizationAgent');
const learningAgent = require('./agents/learningAgent');
const slackService = require('./slackService');
const database = require('../utils/database');
const logger = require('../utils/logger');
const { buildCompletionBlocks, buildErrorBlocks } = require('./messageBuilder');

class InteractiveHandler {
  /**
   * Handle all interactive payloads
   * @param {Object} payload - Slack interactive payload
   */
  async handleInteraction(payload) {
    const { type, actions, user, message, channel } = payload;

    try {
      // Extract file ID from message metadata
      const fileId = message?.metadata?.event_payload?.file_id;

      if (!fileId) {
        logger.error('No file ID in interaction payload');
        return;
      }

      const action = actions[0];
      const actionId = action.action_id;

      logger.info('Handling interaction', {
        actionId,
        fileId,
        userId: user.id,
      });

      switch (actionId) {
        case 'confirm_classification':
          await this.handleConfirmation(fileId, payload);
          break;

        case 'change_category':
          await this.handleCategoryChange(fileId, action.selected_option.value, payload);
          break;

        case 'edit_filename':
          await this.handleFilenameEdit(fileId, payload);
          break;

        case 'skip_classification':
          await this.handleSkip(fileId, payload);
          break;

        default:
          logger.warn('Unknown action ID', { actionId });
      }
    } catch (error) {
      logger.logError('Interactive handler error', error, {
        type,
        actionId: actions?.[0]?.action_id,
      });

      // Send error message to channel
      if (payload.channel) {
        await slackService.sendMessage(payload.channel.id, {
          text: '❌ 처리 중 오류가 발생했습니다.',
          blocks: buildErrorBlocks(error),
        });
      }
    }
  }

  /**
   * Handle confirmation (user accepts AI suggestion)
   */
  async handleConfirmation(fileId, payload) {
    const uploadRecord = database.getUpload(fileId);
    const classificationResult = JSON.parse(uploadRecord.classification_result || '{}');

    // Run agents
    const organizationResult = await organizationAgent.organize(fileId, {
      category: classificationResult.category,
      filename: classificationResult.suggestedFilename,
      feedbackType: 'Confirmed',
    });

    await learningAgent.trackFeedback(fileId, {
      category: classificationResult.category,
      filename: classificationResult.suggestedFilename,
      categoryFolderUrl: organizationResult.categoryFolder.url,
    }, classificationResult);

    // Update message
    await slackService.updateMessage(payload.channel.id, payload.message.ts, {
      text: '✅ 저장 완료!',
      blocks: buildCompletionBlocks(organizationResult),
    });
  }

  /**
   * Handle category change
   */
  async handleCategoryChange(fileId, selectedCategory, payload) {
    const uploadRecord = database.getUpload(fileId);
    const classificationResult = JSON.parse(uploadRecord.classification_result || '{}');

    // Use AI suggested filename but different category
    const organizationResult = await organizationAgent.organize(fileId, {
      category: selectedCategory,
      filename: classificationResult.suggestedFilename,
      feedbackType: 'Category Changed',
    });

    await learningAgent.trackFeedback(fileId, {
      category: selectedCategory,
      filename: classificationResult.suggestedFilename,
      categoryFolderUrl: organizationResult.categoryFolder.url,
    }, classificationResult);

    // Update message
    await slackService.updateMessage(payload.channel.id, payload.message.ts, {
      text: '✅ 저장 완료!',
      blocks: buildCompletionBlocks(organizationResult),
    });
  }

  /**
   * Handle filename edit (show modal)
   */
  async handleFilenameEdit(fileId, payload) {
    const uploadRecord = database.getUpload(fileId);
    const classificationResult = JSON.parse(uploadRecord.classification_result || '{}');

    // Open modal for filename input
    // For now, just use a simple flow - in production, use modals
    await slackService.sendMessage(payload.channel.id, {
      text: `파일명 수정: 현재 "${classificationResult.suggestedFilename}"`,
      thread_ts: payload.message.ts,
    });

    logger.info('Filename edit requested - modal not yet implemented', {
      fileId,
      currentFilename: classificationResult.suggestedFilename,
    });
  }

  /**
   * Handle skip (don't classify, keep in date folder only)
   */
  async handleSkip(fileId, payload) {
    database.updateUpload(fileId, {
      user_category: null,
      final_filename: null,
      feedback_type: 'Skipped',
      feedback_tracked: 1,
    });

    // Update message
    await slackService.updateMessage(payload.channel.id, payload.message.ts, {
      text: '건너뛰기 완료',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '⏭️ *분류를 건너뛰었습니다*\n\n파일은 날짜 폴더에만 보관됩니다.',
          },
        },
      ],
    });

    logger.info('Classification skipped', { fileId });
  }
}

// Export singleton instance
module.exports = new InteractiveHandler();
