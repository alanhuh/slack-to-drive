/**
 * Classify All Files Script
 *
 * Classifies all existing uploaded files using Vision API
 * and organizes them into category folders
 */

require('dotenv').config();
const database = require('../utils/database');
const driveService = require('../services/driveService');
const visionApiHelper = require('../services/helpers/visionApiHelper');
const classificationRules = require('../services/helpers/classificationRules');
const organizationAgent = require('../services/agents/organizationAgent');
const slackContextHelper = require('../services/helpers/slackContextHelper');
const logger = require('../utils/logger');

class ClassifyAllFilesScript {
  constructor() {
    this.stats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      byCategory: {},
    };
  }

  /**
   * Run classification for all files
   */
  async run() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 전체 파일 AI 분류 시작...\n');

    try {
      // Step 1: Get all uploaded files
      const files = this.getAllUploadedFiles();
      this.stats.total = files.length;

      if (files.length === 0) {
        console.log('⚠️  업로드된 파일이 없습니다.');
        return;
      }

      console.log(`📊 총 ${files.length}개 파일을 처리합니다.\n`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Step 2: Classify each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await this.classifyFile(file, i + 1);
      }

      // Step 3: Print final statistics
      this.printStatistics();

    } catch (error) {
      console.error('\n❌ 오류 발생:', error.message);
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Get all uploaded files from database
   */
  getAllUploadedFiles() {
    const files = database.db
      .prepare(`
        SELECT
          slack_file_id as file_id,
          original_filename,
          drive_file_id,
          drive_file_url,
          slack_user_id,
          slack_user_name,
          channel_id,
          uploaded_at
        FROM uploads
        WHERE drive_file_id IS NOT NULL
        ORDER BY uploaded_at DESC
      `)
      .all();

    return files;
  }

  /**
   * Classify a single file
   */
  async classifyFile(file, index) {
    const { file_id, original_filename, drive_file_id } = file;

    console.log(`🔍 [${index}/${this.stats.total}] ${original_filename}`);

    try {
      // Download file from Drive
      const fileBuffer = await this.downloadFileFromDrive(drive_file_id);

      if (!fileBuffer) {
        console.log(`  ⚠️  파일 다운로드 실패, 건너뜁니다.\n`);
        this.stats.failed++;
        return;
      }

      // Analyze with Vision API
      console.log(`  📸 Vision API 분석 중...`);
      const visionAnalysis = await visionApiHelper.analyzeImage(fileBuffer);

      // Classify
      const slackContext = { messages: [] }; // No context for batch processing
      const classification = classificationRules.classifyImage(
        visionAnalysis,
        slackContext
      );

      // Print Vision labels
      if (visionAnalysis.labels.length > 0) {
        const topLabels = visionAnalysis.labels.slice(0, 3).map(l => `${l.description} (${l.confidence}%)`);
        console.log(`  🏷️  Vision: ${topLabels.join(', ')}`);
      }

      // Print classification result
      const confidencePercent = Math.round(classification.confidence * 100);
      console.log(`  ✅ 분류: ${classification.category} | 신뢰도: ${confidencePercent}%`);

      // Organize file into category folder
      console.log(`  📁 폴더에 복사 중...`);
      await organizationAgent.organize(file_id, {
        category: classification.category,
        filename: original_filename,
        feedbackType: 'Auto-classified',
      });

      // Update database with classification info
      database.updateUpload(file_id, {
        classification_method: classification.method,
        vision_labels: JSON.stringify(visionAnalysis.labels.map(l => l.description)),
        detected_text: visionAnalysis.text.full.substring(0, 500),
        ai_category: classification.category,
        ai_confidence: classification.confidence,
        suggested_filename: original_filename,
      });

      console.log(`  ✅ 복사 완료!\n`);

      // Update stats
      this.stats.successful++;
      this.stats.byCategory[classification.category] = (this.stats.byCategory[classification.category] || 0) + 1;

    } catch (error) {
      console.log(`  ❌ 오류: ${error.message}\n`);
      this.stats.failed++;
      logger.logError('Classification failed for file', error, { file_id, original_filename });
    } finally {
      this.stats.processed++;
    }
  }

  /**
   * Download file from Drive
   */
  async downloadFileFromDrive(fileId) {
    try {
      // Initialize drive client
      const drive = await driveService.initializeDriveClient();

      const response = await drive.files.get(
        {
          fileId: fileId,
          alt: 'media',
        },
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(response.data);
    } catch (error) {
      logger.logError('Failed to download file from Drive', error, { fileId });
      return null;
    }
  }

  /**
   * Print final statistics
   */
  printStatistics() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 전체 분류 완료!\n');
    console.log('📊 통계:');

    // Sort categories by count
    const sortedCategories = Object.entries(this.stats.byCategory)
      .sort((a, b) => b[1] - a[1]);

    for (const [category, count] of sortedCategories) {
      console.log(`  ${category}: ${count}개`);
    }

    console.log(`  ────────────────────────`);
    console.log(`  총 처리: ${this.stats.processed}개`);
    console.log(`  성공: ${this.stats.successful}개`);
    console.log(`  실패: ${this.stats.failed}개`);

    const successRate = this.stats.total > 0
      ? Math.round((this.stats.successful / this.stats.total) * 100)
      : 0;
    console.log(`  성공률: ${successRate}%`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

// Run the script
const script = new ClassifyAllFilesScript();
script.run().then(() => {
  console.log('🎉 작업 완료!');
  process.exit(0);
}).catch(error => {
  console.error('💥 오류 발생:', error);
  process.exit(1);
});
