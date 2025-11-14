/**
 * Bulk Upload from Slack
 *
 * 과거 Slack 메시지에서 이미지를 소급해서 Google Drive에 업로드하는 스크립트
 *
 * Usage:
 *   node scripts/bulk-upload-from-slack.js --channel C12345 --user U12345
 *   node scripts/bulk-upload-from-slack.js --channel C12345  (전체 유저)
 *   node scripts/bulk-upload-from-slack.js --user U12345      (전체 채널)
 */

require('dotenv').config();
const slackService = require('../services/slackService');
const driveService = require('../services/driveService');
const database = require('../utils/database');
const logger = require('../utils/logger');
const notionLogger = require('../services/notionLogger');

// Command line arguments parsing
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];
  options[key] = value;
}

const CHANNEL_ID = options.channel;
const USER_ID = options.user;
const BATCH_SIZE = 10; // 한 번에 처리할 파일 수
const DELAY_MS = 2000; // API rate limit 고려 (2초 간격)

/**
 * Sleep 함수
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Slack에서 파일 목록 가져오기
 */
async function fetchSlackFiles() {
  logger.info('Fetching files from Slack...', { channel: CHANNEL_ID, user: USER_ID });

  const params = {
    types: 'images',
    count: 100, // 한 페이지당 최대 파일 수
  };

  if (CHANNEL_ID) {
    params.channel = CHANNEL_ID;
  }

  if (USER_ID) {
    params.user = USER_ID;
  }

  const allFiles = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    logger.info(`Fetching page ${page}...`);

    const response = await slackService.slackClient.files.list(params);

    // 응답 확인
    if (!response) {
      throw new Error('No response from Slack API');
    }

    logger.info('Slack API response', { ok: response.ok, hasFiles: !!response.files, filesCount: response.files?.length });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    // response.files가 없으면 빈 배열 사용
    if (response.files && response.files.length > 0) {
      allFiles.push(...response.files);
    }

    // 페이지네이션 처리
    const paging = response.paging;
    if (paging && paging.page < paging.pages) {
      params.page = ++page;
      await sleep(1000); // Rate limit 고려
    } else {
      hasMore = false;
    }
  }

  logger.info(`Found ${allFiles.length} image files`);
  return allFiles;
}

/**
 * 이미 업로드된 파일인지 확인
 */
function isAlreadyUploaded(fileId) {
  const existing = database.getUpload(fileId);
  return existing && existing.status === 'completed';
}

/**
 * 파일 업로드 처리
 */
async function uploadFile(file) {
  const fileId = file.id;
  const filename = file.name;
  const fileSize = file.size;
  const mimeType = file.mimetype;
  const userId = file.user;
  const channelId = file.channels && file.channels[0];

  logger.info('Uploading file', { fileId, filename });

  try {
    // 1. 데이터베이스 레코드 생성
    const userInfo = await slackService.getUserInfo(userId);

    database.insertUpload({
      slackFileId: fileId,
      slackUserId: userId,
      slackUserName: userInfo.name,
      channelId: channelId || 'unknown',
      originalFilename: filename,
      fileSize,
      mimeType,
      status: 'pending',
    });

    // 2. Notion 로그 생성
    let notionPageId = null;
    if (notionLogger.isEnabled()) {
      notionPageId = await notionLogger.logUpload({
        slackFileId: fileId,
        slackUserId: userId,
        slackUserName: userInfo.name,
        channelId: channelId || 'unknown',
        filename,
        fileSize,
        mimeType,
        status: 'Pending',
      });

      if (notionPageId) {
        database.updateUpload(fileId, { notion_page_id: notionPageId });
      }
    }

    // 3. 상태 업데이트: Processing
    database.updateUpload(fileId, { status: 'processing' });
    if (notionPageId) {
      await notionLogger.updateUploadStatus(notionPageId, fileId, {
        status: 'Processing',
      });
    }

    const startTime = Date.now();

    // 4. Slack에서 다운로드
    const fileStream = await slackService.downloadFileStream(file.url_private_download);

    // 5. Google Drive에 업로드
    const driveFile = await driveService.uploadFile(
      fileStream,
      filename,
      mimeType
    );

    const processingTime = Date.now() - startTime;

    // 6. 완료 상태 업데이트
    database.updateUpload(fileId, {
      status: 'completed',
      drive_file_id: driveFile.id,
      drive_file_name: driveFile.name,
      drive_file_url: driveFile.url,
      drive_folder_path: driveFile.folderId,
      uploaded_at: new Date().toISOString(),
    });

    if (notionPageId) {
      await notionLogger.updateUploadStatus(notionPageId, fileId, {
        status: 'Completed',
        driveFileId: driveFile.id,
        driveUrl: driveFile.url,
        processingTimeMs: processingTime,
      });
    }

    logger.info('File uploaded successfully', {
      fileId,
      driveFileId: driveFile.id,
      driveUrl: driveFile.url,
      processingTime: `${processingTime}ms`,
    });

    return { success: true, fileId, driveUrl: driveFile.url };

  } catch (error) {
    logger.logError('File upload failed', error, { fileId, filename });

    database.updateUpload(fileId, {
      status: 'failed',
      error_message: error.message,
    });

    const uploadRecord = database.getUpload(fileId);
    const notionPageId = uploadRecord?.notion_page_id;

    if (notionPageId) {
      await notionLogger.updateUploadStatus(notionPageId, fileId, {
        status: 'Failed',
        errorMessage: error.message,
      });
    }

    return { success: false, fileId, error: error.message };
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('🚀 Slack Bulk Upload Script');
  console.log('============================\n');

  if (!CHANNEL_ID && !USER_ID) {
    console.error('❌ Error: --channel 또는 --user 옵션이 필요합니다.\n');
    console.log('Usage:');
    console.log('  node scripts/bulk-upload-from-slack.js --channel C12345 --user U12345');
    console.log('  node scripts/bulk-upload-from-slack.js --channel C12345  (전체 유저)');
    console.log('  node scripts/bulk-upload-from-slack.js --user U12345      (전체 채널)\n');
    process.exit(1);
  }

  console.log('Options:');
  if (CHANNEL_ID) console.log(`  Channel: ${CHANNEL_ID}`);
  if (USER_ID) console.log(`  User: ${USER_ID}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Delay: ${DELAY_MS}ms\n`);

  try {
    // 1. Slack 연결 테스트
    console.log('📡 Testing Slack connection...');
    await slackService.testConnection();
    console.log('✅ Slack connection OK\n');

    // 2. Drive 연결 테스트
    console.log('📁 Testing Google Drive connection...');
    await driveService.testConnection();
    console.log('✅ Drive connection OK\n');

    // 3. Notion 연결 테스트 (선택 사항)
    if (notionLogger.isEnabled()) {
      console.log('📝 Testing Notion connection...');
      await notionLogger.testConnection();
      console.log('✅ Notion connection OK\n');
    }

    // 4. Slack 파일 목록 가져오기
    console.log('📥 Fetching files from Slack...');
    const files = await fetchSlackFiles();
    console.log(`✅ Found ${files.length} image files\n`);

    // 5. 이미 업로드된 파일 필터링
    const newFiles = files.filter(file => !isAlreadyUploaded(file.id));
    const skippedCount = files.length - newFiles.length;

    console.log(`📊 Upload Statistics:`);
    console.log(`  Total files: ${files.length}`);
    console.log(`  Already uploaded: ${skippedCount}`);
    console.log(`  To upload: ${newFiles.length}\n`);

    if (newFiles.length === 0) {
      console.log('✨ All files are already uploaded. Nothing to do!');
      process.exit(0);
    }

    // 6. 배치 업로드
    console.log('🔄 Starting batch upload...\n');

    const results = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const progress = `[${i + 1}/${newFiles.length}]`;

      console.log(`${progress} Processing: ${file.name}`);

      const result = await uploadFile(file);

      if (result.success) {
        results.success++;
        console.log(`${progress} ✅ Success: ${result.driveUrl}\n`);
      } else {
        results.failed++;
        results.errors.push({ file: file.name, error: result.error });
        console.log(`${progress} ❌ Failed: ${result.error}\n`);
      }

      // 배치 사이즈마다 대기
      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < newFiles.length) {
        console.log(`⏸️  Waiting ${DELAY_MS}ms before next batch...\n`);
        await sleep(DELAY_MS);
      }
    }

    // 7. 최종 결과 출력
    console.log('\n============================');
    console.log('📊 Upload Complete!');
    console.log('============================\n');
    console.log(`✅ Success: ${results.success}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success rate: ${((results.success / newFiles.length) * 100).toFixed(2)}%\n`);

    if (results.errors.length > 0) {
      console.log('Failed files:');
      results.errors.forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error}`);
      });
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    logger.logError('Bulk upload script failed', error);
    process.exit(1);
  }
}

// Run
main();
