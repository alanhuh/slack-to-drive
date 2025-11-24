/**
 * Organization Agent
 *
 * Organizes files into category folders:
 * - Creates category folders if needed
 * - Copies files from date folder to category folder
 * - Updates database and Notion logs
 */

const driveService = require('../driveService');
const database = require('../../utils/database');
const notionLogger = require('../notionLogger');
const logger = require('../../utils/logger');
const config = require('../../config');

class OrganizationAgent {
  /**
   * Organize file into category folder
   * @param {string} fileId - Slack file ID
   * @param {Object} userDecision - User's final decision
   * @returns {Object} Organization result
   */
  async organize(fileId, userDecision) {
    const startTime = Date.now();

    logger.info('Organization Agent: Starting organization', {
      fileId,
      category: userDecision.category,
      filename: userDecision.filename,
    });

    try {
      // Step 1: Get upload record
      const uploadRecord = database.getUpload(fileId);
      if (!uploadRecord || !uploadRecord.drive_file_id) {
        throw new Error('Upload record not found or file not in Drive');
      }

      // Step 2: Get or create category folder
      const categoryFolder = await this.getOrCreateCategoryFolder(userDecision.category);

      // Step 3: Copy file to category folder
      const categoryFile = await this.copyFileToCategory(
        uploadRecord.drive_file_id,
        categoryFolder.id,
        userDecision.filename
      );

      // Step 4: Update database
      database.updateUpload(fileId, {
        user_category: userDecision.category,
        final_filename: categoryFile.name,
        category_folder_id: categoryFolder.id,
        category_file_id: categoryFile.id,
        category_file_url: categoryFile.webViewLink,
        organized_at: new Date().toISOString(),
      });

      // Step 5: Log to Notion Classification DB
      if (notionLogger.isClassificationEnabled()) {
        const classificationPageId = await notionLogger.logClassification({
          fileId: fileId,
          originalFilename: uploadRecord.original_filename,
          category: userDecision.category,
          confidence: uploadRecord.ai_confidence,
          method: uploadRecord.classification_method,
          suggestedFilename: uploadRecord.suggested_filename,
          finalFilename: categoryFile.name,
          dateFolderUrl: uploadRecord.drive_file_url,
          categoryFolderUrl: categoryFile.webViewLink,
          userFeedback: userDecision.feedbackType || 'Confirmed',
          visionLabels: JSON.parse(uploadRecord.vision_labels || '[]'),
          detectedText: uploadRecord.detected_text,
          slackContext: uploadRecord.classification_context,
          userName: uploadRecord.slack_user_name,
          channelId: uploadRecord.channel_id,
          processingTime: Date.now() - startTime,
        });

        if (classificationPageId) {
          database.updateUpload(fileId, {
            classification_notion_page_id: classificationPageId,
          });
        }
      }

      const result = {
        success: true,
        dateFolder: {
          fileId: uploadRecord.drive_file_id,
          url: uploadRecord.drive_file_url,
          filename: uploadRecord.drive_file_name,
        },
        categoryFolder: {
          fileId: categoryFile.id,
          url: categoryFile.webViewLink,
          filename: categoryFile.name,
          folderId: categoryFolder.id,
          folderName: categoryFolder.name,
        },
        processingTime: Date.now() - startTime,
      };

      logger.info('Organization Agent: Completed', {
        fileId,
        categoryPath: `${categoryFolder.name}/${categoryFile.name}`,
        processingTime: `${result.processingTime}ms`,
      });

      return result;
    } catch (error) {
      logger.logError('Organization Agent: Failed', error, {
        fileId,
        category: userDecision.category,
      });
      throw error;
    }
  }

  /**
   * Get or create classification root folder (e.g., "AI_분류")
   * @returns {Object} Folder info
   */
  async getClassificationRootFolder() {
    const rootFolderName = config.classification.rootFolderName;
    const parentFolderId = config.drive.folderId;

    // Check if rootFolderId is explicitly set
    if (config.classification.rootFolderId) {
      return {
        id: config.classification.rootFolderId,
        name: rootFolderName,
      };
    }

    // Check cache
    const cached = database.db
      .prepare('SELECT folder_id FROM category_folders WHERE category_name = ?')
      .get('__ROOT__');

    if (cached) {
      logger.debug('Using cached classification root folder', {
        folderId: cached.folder_id,
      });
      return {
        id: cached.folder_id,
        name: rootFolderName,
      };
    }

    try {
      // Search for existing root folder
      const existingFolder = await this.findCategoryFolder(parentFolderId, rootFolderName);

      if (existingFolder) {
        // Cache it
        database.db
          .prepare("INSERT OR REPLACE INTO category_folders (category_name, folder_id, file_count, last_updated) VALUES (?, ?, 0, datetime('now'))")
          .run('__ROOT__', existingFolder.id);

        logger.info('Found existing classification root folder', {
          name: rootFolderName,
          folderId: existingFolder.id,
        });

        return existingFolder;
      }

      // Create new root folder
      const newFolder = await driveService.drive.files.create({
        requestBody: {
          name: rootFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentFolderId],
        },
        fields: 'id, name',
      });

      // Cache it
      database.db
        .prepare("INSERT INTO category_folders (category_name, folder_id, file_count, last_updated) VALUES (?, ?, 0, datetime('now'))")
        .run('__ROOT__', newFolder.data.id);

      logger.info('Created new classification root folder', {
        name: rootFolderName,
        folderId: newFolder.data.id,
      });

      return {
        id: newFolder.data.id,
        name: rootFolderName,
      };
    } catch (error) {
      logger.logError('Failed to get/create classification root folder', error, {
        name: rootFolderName,
      });
      throw error;
    }
  }

  /**
   * Get or create category folder
   * @param {string} categoryName - Category name
   * @returns {Object} Folder info
   */
  async getOrCreateCategoryFolder(categoryName) {
    // Check cache first
    const cached = database.db
      .prepare('SELECT folder_id, category_name FROM category_folders WHERE category_name = ?')
      .get(categoryName);

    if (cached) {
      logger.debug('Using cached category folder', {
        category: categoryName,
        folderId: cached.folder_id,
      });
      return {
        id: cached.folder_id,
        name: categoryName,
      };
    }

    // Get classification root folder first
    const rootFolder = await this.getClassificationRootFolder();

    try {
      // Search for existing folder first
      const existingFolder = await this.findCategoryFolder(rootFolder.id, categoryName);

      if (existingFolder) {
        // Cache it
        database.db
          .prepare("INSERT OR REPLACE INTO category_folders (category_name, folder_id, file_count, last_updated) VALUES (?, ?, 0, datetime('now'))")
          .run(categoryName, existingFolder.id);

        return existingFolder;
      }

      // Create new folder
      const newFolder = await driveService.drive.files.create({
        requestBody: {
          name: categoryName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolder.id],
        },
        fields: 'id, name',
      });

      // Cache it
      database.db
        .prepare("INSERT INTO category_folders (category_name, folder_id, file_count, last_updated) VALUES (?, ?, 0, datetime('now'))")
        .run(categoryName, newFolder.data.id);

      logger.info('Created new category folder', {
        category: categoryName,
        folderId: newFolder.data.id,
        parent: rootFolder.name,
      });

      return {
        id: newFolder.data.id,
        name: categoryName,
      };
    } catch (error) {
      logger.logError('Failed to create category folder', error, {
        category: categoryName,
      });
      throw error;
    }
  }

  /**
   * Find existing category folder
   */
  async findCategoryFolder(parentId, categoryName) {
    try {
      const response = await driveService.drive.files.list({
        q: `name='${categoryName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1,
      });

      if (response.data.files && response.data.files.length > 0) {
        return {
          id: response.data.files[0].id,
          name: response.data.files[0].name,
        };
      }

      return null;
    } catch (error) {
      logger.warn('Failed to search for category folder', error);
      return null;
    }
  }

  /**
   * Copy file to category folder
   */
  async copyFileToCategory(sourceFileId, targetFolderId, newFilename) {
    try {
      const copiedFile = await driveService.drive.files.copy({
        fileId: sourceFileId,
        requestBody: {
          name: newFilename,
          parents: [targetFolderId],
        },
        fields: 'id, name, webViewLink',
      });

      logger.info('File copied to category folder', {
        sourceFileId,
        targetFolderId,
        newFileId: copiedFile.data.id,
        filename: newFilename,
      });

      return copiedFile.data;
    } catch (error) {
      logger.logError('Failed to copy file', error, {
        sourceFileId,
        targetFolderId,
        newFilename,
      });
      throw error;
    }
  }

  /**
   * Update folder file count
   */
  updateFolderFileCount(categoryName) {
    try {
      database.db
        .prepare("UPDATE category_folders SET file_count = file_count + 1, last_updated = datetime('now') WHERE category_name = ?")
        .run(categoryName);
    } catch (error) {
      logger.warn('Failed to update folder file count', error);
    }
  }
}

// Export singleton instance
module.exports = new OrganizationAgent();
