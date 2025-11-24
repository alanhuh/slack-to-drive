/**
 * Learning Agent
 *
 * Tracks user feedback and classification performance:
 * - Records user corrections
 * - Calculates accuracy statistics
 * - Generates learning reports
 */

const database = require('../../utils/database');
const notionLogger = require('../notionLogger');
const logger = require('../../utils/logger');
const config = require('../../config');

class LearningAgent {
  /**
   * Track user feedback
   * @param {string} fileId - Slack file ID
   * @param {Object} userDecision - User's final decision
   * @param {Object} aiSuggestion - Original AI suggestion
   * @returns {Object} Feedback stats
   */
  async trackFeedback(fileId, userDecision, aiSuggestion) {
    logger.info('Learning Agent: Tracking feedback', {
      fileId,
      aiCategory: aiSuggestion.category,
      userCategory: userDecision.category,
    });

    try {
      // Step 1: Determine feedback type
      const feedbackType = this.determineFeedbackType(aiSuggestion, userDecision);

      // Step 2: Store feedback in database
      const uploadRecord = database.getUpload(fileId);

      database.db
        .prepare(`
          INSERT INTO classification_feedback
          (file_id, ai_category, ai_confidence, user_category, feedback_type, context, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `)
        .run(
          fileId,
          aiSuggestion.category,
          aiSuggestion.confidence,
          userDecision.category,
          feedbackType,
          uploadRecord?.classification_context || '{}'
        );

      // Step 3: Update upload record
      database.updateUpload(fileId, {
        feedback_type: feedbackType,
        feedback_tracked: 1,
      });

      // Step 4: Update Notion classification log
      if (notionLogger.isClassificationEnabled() && uploadRecord?.classification_notion_page_id) {
        await notionLogger.updateClassificationFeedback(
          uploadRecord.classification_notion_page_id,
          {
            type: feedbackType,
            finalCategory: userDecision.category,
            finalFilename: userDecision.filename,
            categoryFolderUrl: userDecision.categoryFolderUrl,
          }
        );
      }

      // Step 5: Get current statistics
      const stats = this.calculateStatistics();

      // Step 6: Generate report if threshold reached
      if (stats.totalClassifications % config.learning.reportInterval === 0) {
        await this.generateReport(stats);
      }

      logger.info('Learning Agent: Completed', {
        fileId,
        feedbackType,
        totalClassifications: stats.totalClassifications,
        overallAccuracy: stats.overallAccuracy.toFixed(2),
      });

      return stats;
    } catch (error) {
      logger.logError('Learning Agent: Failed', error, {
        fileId,
      });
      // Don't throw - feedback is optional
      return null;
    }
  }

  /**
   * Determine feedback type
   */
  determineFeedbackType(aiSuggestion, userDecision) {
    const categoryChanged = aiSuggestion.category !== userDecision.category;
    const filenameChanged = aiSuggestion.suggestedFilename !== userDecision.filename;

    if (!categoryChanged && !filenameChanged) {
      return 'Confirmed';
    } else if (categoryChanged && filenameChanged) {
      return 'Both Changed';
    } else if (categoryChanged) {
      return 'Category Changed';
    } else if (filenameChanged) {
      return 'Filename Changed';
    }

    return 'Modified';
  }

  /**
   * Calculate classification statistics
   * @returns {Object} Statistics
   */
  calculateStatistics() {
    try {
      // Overall stats
      const total = database.db
        .prepare('SELECT COUNT(*) as count FROM classification_feedback')
        .get();

      const confirmed = database.db
        .prepare("SELECT COUNT(*) as count FROM classification_feedback WHERE feedback_type = 'Confirmed'")
        .get();

      const overallAccuracy = total.count > 0 ? confirmed.count / total.count : 0;

      // Category-wise accuracy
      const categoryStats = database.db
        .prepare(`
          SELECT
            ai_category,
            COUNT(*) as total,
            SUM(CASE WHEN feedback_type = 'Confirmed' OR feedback_type = 'Filename Changed' THEN 1 ELSE 0 END) as correct
          FROM classification_feedback
          GROUP BY ai_category
        `)
        .all();

      const categoryAccuracy = {};
      categoryStats.forEach(row => {
        categoryAccuracy[row.ai_category] = {
          total: row.total,
          correct: row.correct,
          accuracy: row.total > 0 ? row.correct / row.total : 0,
        };
      });

      // Method-wise accuracy
      const methodStats = database.db
        .prepare(`
          SELECT
            uploads.classification_method as method,
            COUNT(*) as total,
            SUM(CASE WHEN feedback.feedback_type = 'Confirmed' OR feedback.feedback_type = 'Filename Changed' THEN 1 ELSE 0 END) as correct
          FROM classification_feedback feedback
          JOIN uploads ON uploads.slack_file_id = feedback.file_id
          GROUP BY uploads.classification_method
        `)
        .all();

      const methodAccuracy = {};
      methodStats.forEach(row => {
        methodAccuracy[row.method] = {
          total: row.total,
          correct: row.correct,
          accuracy: row.total > 0 ? row.correct / row.total : 0,
        };
      });

      return {
        totalClassifications: total.count,
        confirmedCount: confirmed.count,
        overallAccuracy: overallAccuracy,
        categoryAccuracy: categoryAccuracy,
        methodAccuracy: methodAccuracy,
      };
    } catch (error) {
      logger.logError('Failed to calculate statistics', error);
      return {
        totalClassifications: 0,
        confirmedCount: 0,
        overallAccuracy: 0,
        categoryAccuracy: {},
        methodAccuracy: {},
      };
    }
  }

  /**
   * Generate learning report
   * @param {Object} stats - Statistics
   */
  async generateReport(stats) {
    logger.info('Generating learning report', {
      totalClassifications: stats.totalClassifications,
      overallAccuracy: stats.overallAccuracy.toFixed(2),
    });

    // Find categories that need improvement
    const needsImprovement = [];
    for (const [category, data] of Object.entries(stats.categoryAccuracy)) {
      if (data.accuracy < 0.7 && data.total >= 5) {
        needsImprovement.push({
          category,
          accuracy: data.accuracy,
          total: data.total,
        });
      }
    }

    // Log report
    if (needsImprovement.length > 0) {
      logger.warn('Categories needing improvement', {
        categories: needsImprovement,
      });
    }

    // TODO: Could send this to Notion as a report page
    // For now, just log it
    logger.info('Learning report generated', {
      stats: stats,
      needsImprovement: needsImprovement,
    });
  }

  /**
   * Get feedback for category
   * @param {string} category - Category name
   * @returns {Array} Feedback records
   */
  getCategoryFeedback(category) {
    try {
      return database.db
        .prepare(`
          SELECT * FROM classification_feedback
          WHERE ai_category = ?
          ORDER BY created_at DESC
          LIMIT 10
        `)
        .all(category);
    } catch (error) {
      logger.warn('Failed to get category feedback', error);
      return [];
    }
  }
}

// Export singleton instance
module.exports = new LearningAgent();
