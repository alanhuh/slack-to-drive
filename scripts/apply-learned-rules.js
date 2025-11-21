/**
 * Apply Learned Rules Script
 *
 * With the new Skills-based architecture, this script simply:
 * - Validates that learned-rules.json exists and is valid
 * - Shows a summary of learned rules
 * - Reminds user to restart server to apply changes
 *
 * No code modification needed! Rules are loaded at runtime.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

class RuleApplicator {
  constructor() {
    this.learnedRulesPath = path.join(__dirname, '../data/learned-rules.json');
  }

  /**
   * Main execution flow
   */
  async run() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 학습된 규칙 확인 (Skills-based Architecture)\n');

    try {
      // Step 1: Load learned rules
      console.log('📖 Step 1: 학습된 규칙 로드 중...');
      const learnedRules = this.loadLearnedRules();
      console.log(`  ✅ learned-rules.json 로드 완료\n`);

      // Step 2: Validate learned rules
      console.log('✅ Step 2: 규칙 검증 중...');
      this.validateRules(learnedRules);
      console.log(`  ✅ 모든 규칙이 유효합니다\n`);

      // Step 3: Print summary
      this.printSummary(learnedRules);

      console.log('\n✅ 학습된 규칙이 준비되었습니다!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📌 중요: Skills 기반 아키텍처');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('✨ 규칙 적용 방식:');
      console.log('  1. learned-rules.json이 런타임에 자동 로드됨');
      console.log('  2. Base rules와 자동 병합됨');
      console.log('  3. 코드 수정 불필요! 🎉\n');
      console.log('🔄 규칙을 적용하려면:');
      console.log('  • 로컬: 서버 재시작 (npm start)');
      console.log('  • Render: 자동 배포 시 적용됨\n');
      console.log('다음 단계:');
      console.log('  1. node scripts/validate-accuracy.js    # 정확도 검증');
      console.log('  2. node scripts/classify-all-files.js   # 전체 재분류');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
      console.error('\n❌ 오류 발생:', error.message);
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Load learned rules from JSON
   */
  loadLearnedRules() {
    if (!fs.existsSync(this.learnedRulesPath)) {
      throw new Error('learned-rules.json not found. Please run learn-from-corrections.js first.');
    }

    const content = fs.readFileSync(this.learnedRulesPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Validate learned rules format
   */
  validateRules(learnedRules) {
    for (const [category, rules] of Object.entries(learnedRules)) {
      if (rules.noChanges) {
        continue;
      }

      // Check required fields
      if (rules.recommendedPriority === undefined) {
        throw new Error(`Missing recommendedPriority for category: ${category}`);
      }

      if (rules.hasText === undefined) {
        throw new Error(`Missing hasText for category: ${category}`);
      }

      // Validate arrays
      if (!Array.isArray(rules.requiredLabels)) {
        throw new Error(`Invalid requiredLabels for category: ${category}`);
      }

      if (!Array.isArray(rules.recommendedLabels)) {
        throw new Error(`Invalid recommendedLabels for category: ${category}`);
      }

      if (!Array.isArray(rules.antiLabels)) {
        throw new Error(`Invalid antiLabels for category: ${category}`);
      }
    }
  }

  /**
   * Print summary of learned rules
   */
  printSummary(learnedRules) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 학습된 규칙 요약\n');

    let changesCount = 0;
    let noChangesCount = 0;

    for (const [category, rules] of Object.entries(learnedRules)) {
      if (rules.noChanges) {
        console.log(`${category}:`);
        console.log(`  ⚠️  변경 사항 없음 (${rules.reason})\n`);
        noChangesCount++;
        continue;
      }

      changesCount++;
      console.log(`${category}:`);
      console.log(`  📈 Priority: ${rules.recommendedPriority}`);
      console.log(`  📝 hasText: ${rules.hasText}`);
      console.log(`  🏷️  Required labels: ${rules.requiredLabels.length}개`);
      console.log(`  💡 Recommended labels: ${rules.recommendedLabels.length}개`);
      console.log(`  🚫 Anti-labels: ${rules.antiLabels.length}개`);
      console.log(`  📊 Sample size: ${rules.sampleSize}개`);
      console.log(`  🎯 Avg confidence: ${(rules.avgConfidence * 100).toFixed(1)}%\n`);
    }

    console.log(`총 ${Object.keys(learnedRules).length}개 카테고리:`);
    console.log(`  • 규칙 업데이트: ${changesCount}개`);
    console.log(`  • 변경 없음: ${noChangesCount}개`);
  }
}

// Run the script
const applicator = new RuleApplicator();
applicator.run().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 오류 발생:', error);
  process.exit(1);
});
