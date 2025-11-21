/**
 * Learn from User Corrections Script
 *
 * Analyzes differences between AI classifications and user corrections
 * to learn patterns and improve classification accuracy.
 *
 * Workflow:
 * 1. Collect current file locations from Google Drive
 * 2. Collect original AI classifications from Database
 * 3. Collect Vision API analysis from Notion
 * 4. Analyze differences (corrections)
 * 5. Learn patterns from correct classifications
 * 6. Generate improved classification rules
 * 7. Save learned rules and report
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../utils/database');
const driveService = require('../services/driveService');
const logger = require('../utils/logger');
const config = require('../config');

class LearningEngine {
  constructor() {
    this.stats = {
      totalFiles: 0,
      corrected: 0,
      unchanged: 0,
      byCategory: {},
    };

    this.learnedPatterns = {};
  }

  /**
   * Main execution flow
   */
  async run() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧠 AI 분류 학습 시작...\n');

    try {
      // Step 1: Collect data
      console.log('📊 Step 1: 데이터 수집 중...\n');

      const driveFiles = await this.collectDriveData();
      console.log(`  ✅ Drive 파일 위치: ${driveFiles.length}개`);

      const dbClassifications = this.collectDatabaseData();
      console.log(`  ✅ Database 분류 정보: ${dbClassifications.length}개\n`);

      // Step 2: Analyze differences
      console.log('🔍 Step 2: 분류 차이 분석 중...\n');
      const corrections = this.analyzeDifferences(driveFiles, dbClassifications);

      console.log(`📈 분석 결과:`);
      console.log(`  - 총 파일: ${this.stats.totalFiles}개`);
      console.log(`  - 수정됨: ${this.stats.corrected}개`);
      console.log(`  - 유지됨: ${this.stats.unchanged}개\n`);

      if (corrections.length === 0) {
        console.log('⚠️  수정된 파일이 없습니다. 학습할 데이터가 없습니다.');
        return;
      }

      // Step 3: Learn patterns
      console.log('🧠 Step 3: 패턴 학습 중...\n');
      const patterns = this.learnPatterns(corrections);

      // Step 4: Generate rules
      console.log('📝 Step 4: 분류 규칙 생성 중...\n');
      const learnedRules = this.generateRules(patterns);

      // Step 5: Save results
      console.log('💾 Step 5: 학습 결과 저장 중...\n');
      this.saveResults(learnedRules, patterns, corrections);

      // Step 6: Print summary
      this.printSummary(learnedRules);

      console.log('\n✅ 학습 완료!\n');
      console.log('다음 단계:');
      console.log('  1. node scripts/apply-learned-rules.js  # 규칙 적용');
      console.log('  2. node scripts/validate-accuracy.js    # 정확도 검증');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
      console.error('\n❌ 오류 발생:', error.message);
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Collect current file locations from Google Drive
   */
  async collectDriveData() {
    const drive = await driveService.initializeDriveClient();
    const rootFolder = await this.getClassificationRootFolder(drive);

    const allFiles = [];
    const categories = config.classification.categories;

    for (const category of categories) {
      const categoryFiles = await this.getCategoryFiles(drive, rootFolder.id, category);
      allFiles.push(...categoryFiles);
    }

    return allFiles;
  }

  /**
   * Get classification root folder
   */
  async getClassificationRootFolder(drive) {
    const rootFolderName = config.classification.rootFolderName;
    const parentFolderId = config.drive.folderId;

    const response = await drive.files.list({
      q: `name='${rootFolderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (!response.data.files || response.data.files.length === 0) {
      throw new Error(`Classification root folder "${rootFolderName}" not found`);
    }

    return response.data.files[0];
  }

  /**
   * Get files in a category folder
   */
  async getCategoryFiles(drive, rootFolderId, categoryName) {
    // Find category folder
    const response = await drive.files.list({
      q: `name='${categoryName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (!response.data.files || response.data.files.length === 0) {
      return [];
    }

    const categoryFolderId = response.data.files[0].id;

    // List files in category folder
    const filesResponse = await drive.files.list({
      q: `'${categoryFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1000,
    });

    return (filesResponse.data.files || []).map(file => ({
      filename: file.name,
      driveFileId: file.id,
      currentCategory: categoryName,
    }));
  }

  /**
   * Collect original AI classifications from Database
   */
  collectDatabaseData() {
    const files = database.db
      .prepare(`
        SELECT
          slack_file_id as file_id,
          original_filename,
          drive_file_id,
          ai_category,
          user_category,
          ai_confidence,
          classification_method,
          vision_labels,
          detected_text
        FROM uploads
        WHERE drive_file_id IS NOT NULL
      `)
      .all();

    return files.map(file => ({
      fileId: file.file_id,
      filename: file.original_filename,
      driveFileId: file.drive_file_id,
      aiCategory: file.ai_category,
      userCategory: file.user_category,
      confidence: file.ai_confidence,
      method: file.classification_method,
      visionLabels: file.vision_labels ? JSON.parse(file.vision_labels) : [],
      detectedText: file.detected_text || '',
    }));
  }

  /**
   * Analyze differences between AI classifications and current Drive locations
   */
  analyzeDifferences(driveFiles, dbClassifications) {
    const corrections = [];
    this.stats.totalFiles = dbClassifications.length;

    // Create lookup map for drive files
    const driveMap = new Map();
    for (const file of driveFiles) {
      driveMap.set(file.filename, file.currentCategory);
    }

    // Compare AI classification with current Drive location
    for (const dbFile of dbClassifications) {
      const currentCategory = driveMap.get(dbFile.filename);

      if (!currentCategory) {
        // File not found in Drive (possibly deleted)
        continue;
      }

      const aiCategory = dbFile.aiCategory || dbFile.userCategory;

      if (currentCategory !== aiCategory) {
        // User corrected the classification
        corrections.push({
          filename: dbFile.filename,
          aiCategory: aiCategory,
          correctCategory: currentCategory,
          visionLabels: dbFile.visionLabels,
          detectedText: dbFile.detectedText,
          confidence: dbFile.confidence,
        });

        this.stats.corrected++;
        this.stats.byCategory[currentCategory] = (this.stats.byCategory[currentCategory] || 0) + 1;
      } else {
        this.stats.unchanged++;
      }
    }

    return corrections;
  }

  /**
   * Learn patterns from correct classifications
   */
  learnPatterns(corrections) {
    const patterns = {};
    const categories = config.classification.categories;

    // Initialize patterns for each category
    for (const category of categories) {
      patterns[category] = {
        labelFrequency: {},
        antiLabelFrequency: {},
        textLengths: [],
        confidences: [],
        count: 0,
      };
    }

    // Analyze corrections
    for (const correction of corrections) {
      const category = correction.correctCategory;
      const pattern = patterns[category];

      pattern.count++;

      // Count Vision label frequencies
      for (const label of correction.visionLabels) {
        pattern.labelFrequency[label] = (pattern.labelFrequency[label] || 0) + 1;
      }

      // Track text lengths
      pattern.textLengths.push(correction.detectedText.length);
      pattern.confidences.push(correction.confidence);

      // Track anti-labels (labels that appeared in wrong classifications)
      const wrongCategory = correction.aiCategory;
      if (wrongCategory !== category) {
        const wrongPattern = patterns[wrongCategory];
        for (const label of correction.visionLabels) {
          wrongPattern.antiLabelFrequency[label] = (wrongPattern.antiLabelFrequency[label] || 0) + 1;
        }
      }
    }

    // Calculate statistics
    for (const category of categories) {
      const pattern = patterns[category];

      // Sort labels by frequency
      pattern.topLabels = Object.entries(pattern.labelFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, freq]) => ({
          label,
          frequency: freq,
          percentage: pattern.count > 0 ? Math.round((freq / pattern.count) * 100) : 0,
        }));

      // Sort anti-labels
      pattern.topAntiLabels = Object.entries(pattern.antiLabelFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, freq]) => ({ label, frequency: freq }));

      // Calculate average text length
      pattern.avgTextLength = pattern.textLengths.length > 0
        ? Math.round(pattern.textLengths.reduce((a, b) => a + b, 0) / pattern.textLengths.length)
        : 0;

      // Calculate median text length
      const sortedLengths = [...pattern.textLengths].sort((a, b) => a - b);
      pattern.medianTextLength = sortedLengths.length > 0
        ? sortedLengths[Math.floor(sortedLengths.length / 2)]
        : 0;

      // Calculate average confidence
      pattern.avgConfidence = pattern.confidences.length > 0
        ? pattern.confidences.reduce((a, b) => a + b, 0) / pattern.confidences.length
        : 0;
    }

    return patterns;
  }

  /**
   * Generate improved classification rules
   */
  generateRules(patterns) {
    const learnedRules = {};
    const categories = config.classification.categories;

    for (const category of categories) {
      const pattern = patterns[category];

      if (pattern.count === 0) {
        // No corrections for this category, keep existing rules
        learnedRules[category] = {
          noChanges: true,
          reason: 'No corrections found',
        };
        continue;
      }

      // Generate recommended rules
      learnedRules[category] = {
        // Required labels (appear in >50% of correct classifications)
        requiredLabels: pattern.topLabels
          .filter(l => l.percentage >= 50)
          .map(l => l.label),

        // Recommended labels (appear in >30% of correct classifications)
        recommendedLabels: pattern.topLabels
          .filter(l => l.percentage >= 30 && l.percentage < 50)
          .map(l => l.label),

        // Anti-labels (appeared in wrong classifications)
        antiLabels: pattern.topAntiLabels.map(l => l.label),

        // Text constraints
        hasText: pattern.avgTextLength > 30,
        avgTextLength: pattern.avgTextLength,
        medianTextLength: pattern.medianTextLength,
        textLengthThreshold: pattern.medianTextLength,

        // Priority adjustment
        recommendedPriority: this.calculatePriority(pattern, patterns),

        // Statistics
        sampleSize: pattern.count,
        avgConfidence: pattern.avgConfidence,
      };
    }

    return learnedRules;
  }

  /**
   * Calculate recommended priority for a category
   */
  calculatePriority(pattern, allPatterns) {
    // Base priority on:
    // 1. Number of corrections (more corrections = higher priority)
    // 2. Average confidence of correct classifications
    // 3. Distinctiveness of labels

    const maxCount = Math.max(...Object.values(allPatterns).map(p => p.count));
    const countScore = pattern.count / maxCount;
    const confidenceScore = pattern.avgConfidence;

    // Higher score = higher priority
    const priorityScore = (countScore * 0.5) + (confidenceScore * 0.5);

    // Map to priority range (0.7 - 0.95)
    return Math.round((0.7 + (priorityScore * 0.25)) * 100) / 100;
  }

  /**
   * Save learned rules and report
   */
  saveResults(learnedRules, patterns, corrections) {
    const dataDir = path.join(__dirname, '../data');

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save learned rules
    const rulesPath = path.join(dataDir, 'learned-rules.json');
    fs.writeFileSync(rulesPath, JSON.stringify(learnedRules, null, 2));
    console.log(`  ✅ learned-rules.json 저장됨`);

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      patterns: patterns,
      corrections: corrections,
      learnedRules: learnedRules,
    };

    const reportPath = path.join(dataDir, 'classification-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  ✅ classification-report.json 저장됨`);
  }

  /**
   * Print summary of learned rules
   */
  printSummary(learnedRules) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 학습 결과 요약\n');

    for (const [category, rules] of Object.entries(learnedRules)) {
      if (rules.noChanges) {
        console.log(`${category}:`);
        console.log(`  ⚠️  변경 사항 없음 (수정된 파일 없음)\n`);
        continue;
      }

      console.log(`${category} (샘플: ${rules.sampleSize}개):`);

      if (rules.requiredLabels.length > 0) {
        console.log(`  필수 Labels: ${rules.requiredLabels.join(', ')}`);
      }

      if (rules.recommendedLabels.length > 0) {
        console.log(`  권장 Labels: ${rules.recommendedLabels.join(', ')}`);
      }

      if (rules.antiLabels.length > 0) {
        console.log(`  금지 Labels: ${rules.antiLabels.join(', ')}`);
      }

      console.log(`  텍스트 있음: ${rules.hasText ? '예' : '아니오'} (평균 길이: ${rules.avgTextLength}자)`);
      console.log(`  권장 Priority: ${rules.recommendedPriority}`);
      console.log(`  평균 신뢰도: ${Math.round(rules.avgConfidence * 100)}%\n`);
    }
  }
}

// Run the script
const engine = new LearningEngine();
engine.run().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 오류 발생:', error);
  process.exit(1);
});
