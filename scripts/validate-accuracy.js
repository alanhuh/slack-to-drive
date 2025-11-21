/**
 * Validate Accuracy Script
 *
 * Validates the accuracy of learned classification rules
 * - Simulates classification with new rules
 * - Compares with user-corrected classifications
 * - Generates accuracy report
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../utils/database');
const classificationRules = require('../services/helpers/classificationRules');

class AccuracyValidator {
  constructor() {
    this.reportPath = path.join(__dirname, '../data/learned-rules.json');
    this.stats = {
      total: 0,
      correct: 0,
      incorrect: 0,
      byCategory: {},
    };
  }

  /**
   * Main execution flow
   */
  async run() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 정확도 검증 시작...\n');

    try {
      // Step 1: Load classification report
      console.log('📖 Step 1: 분류 리포트 로드 중...');
      const reportData = this.loadReport();
      console.log(`  ✅ 리포트 로드 완료\n`);

      // Step 2: Load user-corrected data
      console.log('📊 Step 2: 사용자 수정 데이터 로드 중...');
      const correctClassifications = this.loadCorrectClassifications(reportData.corrections);
      console.log(`  ✅ ${correctClassifications.length}개 파일 로드\n`);

      // Step 3: Simulate classification with current rules
      console.log('🔍 Step 3: 현재 규칙으로 분류 시뮬레이션 중...\n');
      const results = this.simulateClassification(correctClassifications);

      // Step 4: Calculate accuracy
      console.log('📈 Step 4: 정확도 계산 중...\n');
      this.calculateAccuracy(results);

      // Step 5: Print report
      this.printReport(results);

      console.log('\n✅ 검증 완료!\n');
      console.log('다음 단계:');
      console.log('  - 정확도가 높으면: node scripts/classify-all-files.js');
      console.log('  - 정확도가 낮으면: 규칙 수동 조정 또는 재학습');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
      console.error('\n❌ 오류 발생:', error.message);
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Load classification report
   */
  loadReport() {
    if (!fs.existsSync(this.reportPath)) {
      throw new Error('learned-rules.json not found. Please run learn-from-corrections.js first.');
    }

    const reportDataPath = path.join(__dirname, '../data/classification-report.json');
    if (!fs.existsSync(reportDataPath)) {
      throw new Error('classification-report.json not found. Please run learn-from-corrections.js first.');
    }

    const content = fs.readFileSync(reportDataPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Load user-corrected classifications
   */
  loadCorrectClassifications(corrections) {
    // Get all files with their correct categories
    const files = database.db
      .prepare(`
        SELECT
          slack_file_id as file_id,
          original_filename,
          drive_file_id,
          vision_labels,
          detected_text,
          ai_category
        FROM uploads
        WHERE drive_file_id IS NOT NULL
      `)
      .all();

    // Create map of corrections
    const correctionsMap = new Map();
    for (const correction of corrections) {
      correctionsMap.set(correction.filename, correction.correctCategory);
    }

    // Build dataset with correct categories
    return files.map(file => {
      const correctCategory = correctionsMap.get(file.original_filename);

      return {
        filename: file.original_filename,
        visionLabels: file.vision_labels ? JSON.parse(file.vision_labels) : [],
        detectedText: file.detected_text || '',
        correctCategory: correctCategory || file.ai_category,
        originalAiCategory: file.ai_category,
      };
    });
  }

  /**
   * Simulate classification with current rules
   */
  simulateClassification(files) {
    const results = [];

    for (const file of files) {
      // Prepare vision analysis format
      const visionAnalysis = {
        labels: file.visionLabels.map(label => ({
          description: label,
          score: 0.8, // Dummy score
          confidence: 80,
        })),
        text: {
          hasText: file.detectedText.length > 0,
          full: file.detectedText,
        },
      };

      // Classify with current rules
      const slackContext = { messages: [] }; // No context
      const classification = classificationRules.classifyImage(visionAnalysis, slackContext);

      // Compare with correct category
      const isCorrect = classification.category === file.correctCategory;

      results.push({
        filename: file.filename,
        correctCategory: file.correctCategory,
        predictedCategory: classification.category,
        confidence: classification.confidence,
        isCorrect,
        originalAiCategory: file.originalAiCategory,
      });

      this.stats.total++;
      if (isCorrect) {
        this.stats.correct++;
      } else {
        this.stats.incorrect++;
      }

      // Update category stats
      if (!this.stats.byCategory[file.correctCategory]) {
        this.stats.byCategory[file.correctCategory] = {
          total: 0,
          correct: 0,
          incorrect: 0,
        };
      }
      this.stats.byCategory[file.correctCategory].total++;
      if (isCorrect) {
        this.stats.byCategory[file.correctCategory].correct++;
      } else {
        this.stats.byCategory[file.correctCategory].incorrect++;
      }
    }

    return results;
  }

  /**
   * Calculate accuracy
   */
  calculateAccuracy(results) {
    this.stats.accuracy = this.stats.total > 0
      ? (this.stats.correct / this.stats.total) * 100
      : 0;

    // Calculate per-category accuracy
    for (const [category, stats] of Object.entries(this.stats.byCategory)) {
      stats.accuracy = stats.total > 0
        ? (stats.correct / stats.total) * 100
        : 0;
    }
  }

  /**
   * Print validation report
   */
  printReport(results) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 정확도 검증 결과\n');

    // Overall accuracy
    console.log(`전체 정확도: ${this.stats.correct}/${this.stats.total} (${this.stats.accuracy.toFixed(1)}%)\n`);

    // Per-category accuracy
    console.log('카테고리별 정확도:');
    const categories = Object.keys(this.stats.byCategory).sort();
    for (const category of categories) {
      const stats = this.stats.byCategory[category];
      const bar = this.createProgressBar(stats.accuracy);
      console.log(`  ${category}:`);
      console.log(`    ${stats.correct}/${stats.total} (${stats.accuracy.toFixed(1)}%) ${bar}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Show misclassifications if any
    const misclassified = results.filter(r => !r.isCorrect);
    if (misclassified.length > 0 && misclassified.length <= 20) {
      console.log('\n잘못 분류된 파일:\n');
      for (const result of misclassified) {
        console.log(`  ❌ ${result.filename}`);
        console.log(`     올바른 분류: ${result.correctCategory}`);
        console.log(`     예측 분류: ${result.predictedCategory} (신뢰도: ${Math.round(result.confidence * 100)}%)`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else if (misclassified.length > 20) {
      console.log(`\n⚠️  ${misclassified.length}개 파일이 잘못 분류되었습니다.`);
      console.log('   (너무 많아 표시하지 않음)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // Recommendations
    console.log('\n💡 권장 사항:\n');
    if (this.stats.accuracy >= 90) {
      console.log('  ✅ 정확도가 매우 높습니다! 전체 재분류를 진행하세요.');
    } else if (this.stats.accuracy >= 75) {
      console.log('  ⚠️  정확도가 양호합니다. 잘못 분류된 파일을 확인하세요.');
    } else {
      console.log('  ❌ 정확도가 낮습니다. 다음을 시도하세요:');
      console.log('     1. 더 많은 파일을 수동으로 재분류');
      console.log('     2. 재학습 실행');
      console.log('     3. 분류 규칙 수동 조정');
    }
  }

  /**
   * Create progress bar
   */
  createProgressBar(percentage) {
    const filled = Math.round(percentage / 5);
    const empty = 20 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }
}

// Run the script
const validator = new AccuracyValidator();
validator.run().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 오류 발생:', error);
  process.exit(1);
});
