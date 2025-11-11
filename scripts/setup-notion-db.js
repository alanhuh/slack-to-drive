/**
 * Notion Database Setup Script
 * Creates the upload log database in Notion
 *
 * Usage: node scripts/setup-notion-db.js <parent-page-id>
 *
 * Get parent page ID from your Notion page URL:
 * https://notion.so/My-Page-abc123def456
 * → Parent Page ID: abc123def456
 */

require('dotenv').config();
const notionLogger = require('../services/notionLogger');

async function setup() {
  console.log('\n🚀 Notion 데이터베이스 설정 시작...\n');

  // Get parent page ID from command line
  const parentPageId = process.argv[2];

  if (!parentPageId) {
    console.error('❌ 에러: Parent Page ID가 필요합니다.\n');
    console.log('사용법:');
    console.log('  node scripts/setup-notion-db.js <parent-page-id>\n');
    console.log('예시:');
    console.log('  node scripts/setup-notion-db.js abc123def456\n');
    console.log('💡 Notion 페이지 URL에서 Page ID를 확인하세요:');
    console.log('  https://notion.so/My-Page-abc123def456');
    console.log('  → Parent Page ID: abc123def456\n');
    process.exit(1);
  }

  // Check if NOTION_API_KEY is set
  if (!process.env.NOTION_API_KEY) {
    console.error('❌ 에러: NOTION_API_KEY가 설정되지 않았습니다.\n');
    console.log('.env 파일에 다음을 추가하세요:');
    console.log('  NOTION_API_KEY=secret_your_api_key_here\n');
    console.log('💡 Notion Integration에서 API Key를 발급받으세요:');
    console.log('  https://www.notion.so/my-integrations\n');
    process.exit(1);
  }

  try {
    // Create database
    console.log(`📝 Parent Page ID: ${parentPageId}`);
    console.log('⏳ 데이터베이스 생성 중...\n');

    const dbId = await notionLogger.createUploadLogDatabase(parentPageId);

    console.log('✅ 설정 완료!\n');
    console.log('다음 단계:');
    console.log('1. .env 파일을 열어서 다음 내용을 추가하세요:');
    console.log(`   NOTION_UPLOAD_LOG_DB_ID=${dbId}`);
    console.log(`   ENABLE_NOTION_LOGGING=true\n`);
    console.log('2. 서버를 재시작하세요:');
    console.log('   npm run dev\n');
    console.log('3. Notion에서 데이터베이스를 확인하세요:');
    console.log(`   https://notion.so/${dbId.replace(/-/g, '')}\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 설정 실패:', error.message);

    if (error.code === 'object_not_found') {
      console.log('\n💡 문제 해결:');
      console.log('1. Parent Page ID가 올바른지 확인하세요');
      console.log('2. Integration이 해당 페이지에 접근 권한이 있는지 확인하세요');
      console.log('   → Notion 페이지에서 "Share" → Integration 추가\n');
    } else if (error.code === 'unauthorized') {
      console.log('\n💡 문제 해결:');
      console.log('1. NOTION_API_KEY가 올바른지 확인하세요');
      console.log('2. Integration이 활성화되어 있는지 확인하세요\n');
    }

    process.exit(1);
  }
}

// Run setup
setup();
