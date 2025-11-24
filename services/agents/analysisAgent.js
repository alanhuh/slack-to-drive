/**
 * Analysis Agent
 *
 * Analyzes uploaded images using:
 * - Google Cloud Vision API
 * - Slack message context
 * - Classification rules
 */

const visionApiHelper = require('../helpers/visionApiHelper');
const classificationRules = require('../helpers/classificationRules');
const filenameGenerator = require('../helpers/filenameGenerator');
const SlackContextHelper = require('../helpers/slackContextHelper');
const slackService = require('../slackService');
const driveService = require('../driveService');
const database = require('../../utils/database');
const logger = require('../../utils/logger');
const config = require('../../config');

class AnalysisAgent {
  constructor() {
    this.contextHelper = new SlackContextHelper(slackService.client);
  }

  /**
   * Analyze image and classify
   * @param {Object} fileInfo - Slack file information
   * @returns {Object} Classification result
   */
  async analyze(fileInfo) {
    const startTime = Date.now();

    logger.info('Analysis Agent: Starting analysis', {
      fileId: fileInfo.id,
      filename: fileInfo.name,
    });

    try {
      // Step 1: Download image as buffer
      const imageBuffer = await this.downloadImageBuffer(fileInfo);

      // Step 2: Collect Slack context
      const slackContext = await this.contextHelper.collectContext(fileInfo);

      // Step 3: Get existing folder structure
      const folderStructure = await this.getFolderStructure();

      // Step 4: Analyze with Vision API (includeObjects for multi-character detection)
      const visionAnalysis = await visionApiHelper.analyzeImage(imageBuffer, { includeObjects: true });

      // Step 5: Classify using rules
      const classification = classificationRules.classifyImage(
        visionAnalysis,
        slackContext,
        folderStructure.categories
      );

      // Step 6: Generate filename
      const suggestedFilename = filenameGenerator.generateFilename({
        originalFilename: fileInfo.name,
        category: classification.category,
        slackContext: slackContext,
        visionAnalysis: visionAnalysis,
        mimeType: fileInfo.mimetype,
      });

      // Step 7: Build result
      const result = {
        category: classification.category,
        confidence: classification.confidence,
        method: classification.method,
        suggestedFilename: suggestedFilename,
        reasoning: this.buildReasoning(classification, slackContext, visionAnalysis),
        confirmationQuestion: this.buildConfirmationQuestion(
          classification.category,
          suggestedFilename
        ),
        visionLabels: visionAnalysis.labels.map(l => l.description),
        detectedText: visionAnalysis.text.full.slice(0, 200),
        alternatives: classification.alternatives,
        processingTime: Date.now() - startTime,
      };

      // Step 8: Store in database
      database.updateUpload(fileInfo.id, {
        classification_method: result.method,
        vision_labels: JSON.stringify(result.visionLabels),
        detected_text: result.detectedText,
        ai_category: result.category,
        ai_confidence: result.confidence,
        suggested_filename: result.suggestedFilename,
        classification_context: JSON.stringify(slackContext),
        classification_result: JSON.stringify(result),
      });

      logger.info('Analysis Agent: Completed', {
        fileId: fileInfo.id,
        category: result.category,
        confidence: result.confidence.toFixed(2),
        method: result.method,
        processingTime: `${result.processingTime}ms`,
      });

      return result;
    } catch (error) {
      logger.logError('Analysis Agent: Failed', error, {
        fileId: fileInfo.id,
      });
      throw error;
    }
  }

  /**
   * Download image as buffer
   */
  async downloadImageBuffer(fileInfo) {
    try {
      const response = await slackService.downloadFile(fileInfo.url_private_download);
      return response;
    } catch (error) {
      logger.logError('Failed to download image', error, {
        fileId: fileInfo.id,
      });
      throw error;
    }
  }

  /**
   * Get folder structure from Drive
   */
  async getFolderStructure() {
    try {
      const rootFolderId = config.classification.rootFolderId || config.drive.folderId;

      // Get cached folders from database
      const cachedFolders = database.db
        .prepare('SELECT category_name FROM category_folders')
        .all();

      const categories = cachedFolders.length > 0
        ? cachedFolders.map(f => f.category_name)
        : config.classification.categories;

      return {
        categories: categories,
        rootFolderId: rootFolderId,
      };
    } catch (error) {
      logger.warn('Failed to get folder structure, using default categories', error);
      return {
        categories: config.classification.categories,
        rootFolderId: config.drive.folderId,
      };
    }
  }

  /**
   * Build reasoning text
   */
  buildReasoning(classification, slackContext, visionAnalysis) {
    const parts = [];

    // Slack context
    if (slackContext.summary && slackContext.summary.length > 0) {
      parts.push(`슬랙 메시지: "${slackContext.summary.slice(0, 50)}..."`);
    }

    // Vision labels
    if (visionAnalysis.labels.length > 0) {
      const topLabels = visionAnalysis.labels
        .slice(0, 3)
        .map(l => l.description)
        .join(', ');
      parts.push(`이미지 분석: ${topLabels}`);
    }

    // OCR text
    if (visionAnalysis.text.hasText) {
      parts.push(`텍스트 감지됨`);
    }

    // Classification method
    parts.push(`분류 방식: ${classification.method}`);

    return parts.join(' | ');
  }

  /**
   * Build confirmation question
   */
  buildConfirmationQuestion(category, filename) {
    return `"${category}" 폴더에 "${filename}"로 저장할까요?`;
  }

  /**
   * Check if confidence is high enough
   */
  isConfidenceHigh(confidence) {
    return confidence >= config.classification.confidenceThreshold;
  }
}

// Export singleton instance
module.exports = new AnalysisAgent();
