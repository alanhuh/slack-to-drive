/**
 * Message Builder
 *
 * Builds Slack Block Kit messages for:
 * - Classification results
 * - Completion notifications
 * - Error messages
 */

const config = require('../config');

/**
 * Build classification message blocks
 * @param {Object} classification - Classification result
 * @param {string} fileId - Slack file ID
 * @returns {Object} Slack message payload
 */
function buildClassificationBlocks(classification, fileId) {
  const confidencePercent = Math.round(classification.confidence * 100);
  const confidenceEmoji = confidencePercent >= 90 ? '🎯' : confidencePercent >= 70 ? '✅' : '⚠️';

  return {
    text: `🤖 이미지 분류 완료: ${classification.category}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 이미지 분류 완료!',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📂 카테고리*\n${classification.category}`,
          },
          {
            type: 'mrkdwn',
            text: `*${confidenceEmoji} 신뢰도*\n${confidencePercent}%`,
          },
          {
            type: 'mrkdwn',
            text: `*📝 파일명*\n${classification.suggestedFilename}`,
          },
          {
            type: 'mrkdwn',
            text: `*🔍 분류 방식*\n${getMethodLabel(classification.method)}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💭 분석*\n${classification.reasoning || '자동 분류되었습니다.'}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*❓ ${classification.confirmationQuestion}*`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✓ 맞아요',
              emoji: true,
            },
            style: 'primary',
            action_id: 'confirm_classification',
            value: fileId,
          },
          {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: '📁 다른 폴더',
              emoji: true,
            },
            action_id: 'change_category',
            options: buildCategoryOptions(classification.category),
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏭️ 건너뛰기',
              emoji: true,
            },
            action_id: 'skip_classification',
            value: fileId,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `처리 시간: ${classification.processingTime}ms | Vision API + 분류 규칙`,
          },
        ],
      },
    ],
    metadata: {
      event_type: 'classification_request',
      event_payload: {
        file_id: fileId,
      },
    },
  };
}

/**
 * Build category options for select menu
 */
function buildCategoryOptions(currentCategory) {
  return config.classification.categories
    .filter(cat => cat !== currentCategory)
    .map(category => ({
      text: {
        type: 'plain_text',
        text: category,
        emoji: true,
      },
      value: category,
    }));
}

/**
 * Get method label
 */
function getMethodLabel(method) {
  const labels = {
    'keyword_match': '키워드 매칭',
    'vision_api': 'Vision API',
    'hybrid': '하이브리드',
    'low_confidence': '낮은 신뢰도',
  };
  return labels[method] || method;
}

/**
 * Build completion message blocks
 * @param {Object} result - Organization result
 * @returns {Array} Slack blocks
 */
function buildCompletionBlocks(result) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '✅ 저장 완료!',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `파일이 두 위치에 저장되었습니다:`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📅 날짜 폴더*\n<${result.dateFolder.url}|${result.dateFolder.filename}>`,
        },
        {
          type: 'mrkdwn',
          text: `*📁 분류 폴더*\n<${result.categoryFolder.url}|${result.categoryFolder.folderName}/${result.categoryFolder.filename}>`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `처리 시간: ${result.processingTime}ms`,
        },
      ],
    },
  ];
}

/**
 * Build error message blocks
 * @param {Error} error - Error object
 * @returns {Array} Slack blocks
 */
function buildErrorBlocks(error) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '❌ 오류 발생',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `처리 중 오류가 발생했습니다:\n\`\`\`${error.message}\`\`\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '파일은 날짜 폴더에 저장되었습니다.',
        },
      ],
    },
  ];
}

/**
 * Build low confidence warning blocks
 * @param {Object} classification - Classification result
 * @returns {Array} Additional warning blocks
 */
function buildLowConfidenceWarning(classification) {
  if (classification.confidence >= config.classification.confidenceThreshold) {
    return [];
  }

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *주의*: 신뢰도가 낮습니다 (${Math.round(classification.confidence * 100)}%). 분류가 정확하지 않을 수 있습니다.`,
      },
    },
  ];
}

module.exports = {
  buildClassificationBlocks,
  buildCompletionBlocks,
  buildErrorBlocks,
  buildLowConfidenceWarning,
  buildCategoryOptions,
};
