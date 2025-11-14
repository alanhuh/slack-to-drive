/**
 * Clear Notion Upload Log Database
 *
 * Notion 업로드 로그 데이터베이스의 모든 페이지를 삭제(archive)하는 스크립트
 *
 * Usage:
 *   node scripts/clear-notion-db.js
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const logger = require('../utils/logger');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_UPLOAD_LOG_DB_ID;

if (!NOTION_API_KEY || !DATABASE_ID) {
  console.error('❌ Error: NOTION_API_KEY or NOTION_UPLOAD_LOG_DB_ID not found in .env');
  process.exit(1);
}

const notion = new Client({
  auth: NOTION_API_KEY,
  timeoutMs: 60000,
});

/**
 * Sleep function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Query database using REST API
 */
async function queryDatabaseViaRestApi(databaseId, startCursor = undefined) {
  const https = require('https');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      page_size: 100,
      start_cursor: startCursor,
    });

    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${databaseId}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        } else {
          try {
            const errorData = JSON.parse(responseData);
            reject(new Error(`Notion API error (${res.statusCode}): ${errorData.message || responseData}`));
          } catch {
            reject(new Error(`Notion API error (${res.statusCode}): ${responseData}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Query all pages in database
 */
async function queryAllPages() {
  console.log('📥 Querying all pages from database...');

  const allPages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    try {
      const response = await queryDatabaseViaRestApi(DATABASE_ID, startCursor);

      allPages.push(...response.results);

      hasMore = response.has_more;
      startCursor = response.next_cursor;

      console.log(`  Found ${allPages.length} pages so far...`);

      if (hasMore) {
        await sleep(300); // Rate limit
      }
    } catch (error) {
      console.error('❌ Failed to query pages:', error.message);
      throw error;
    }
  }

  console.log(`✅ Total pages found: ${allPages.length}\n`);
  return allPages;
}

/**
 * Archive (delete) a page
 */
async function archivePage(pageId) {
  try {
    await notion.pages.update({
      page_id: pageId,
      archived: true,
    });
    return { success: true };
  } catch (error) {
    logger.logError('Failed to archive page', error, { pageId });
    return { success: false, error: error.message };
  }
}

/**
 * Archive all pages with progress
 */
async function archiveAllPages(pages) {
  console.log('🗑️  Starting to archive pages...\n');

  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const progress = `[${i + 1}/${pages.length}]`;

    // Get Upload ID from title
    const uploadId = page.properties['Upload ID']?.title?.[0]?.plain_text || 'Unknown';

    console.log(`${progress} Archiving: ${uploadId}`);

    const result = await archivePage(page.id);

    if (result.success) {
      results.success++;
      console.log(`${progress} ✅ Archived`);
    } else {
      results.failed++;
      results.errors.push({ uploadId, error: result.error });
      console.log(`${progress} ❌ Failed: ${result.error}`);
    }

    // Rate limit: 3 requests per second
    if ((i + 1) % 3 === 0 && i + 1 < pages.length) {
      await sleep(1000);
    }
  }

  return results;
}

/**
 * Main function
 */
async function main() {
  console.log('🧹 Notion Database Cleanup Script');
  console.log('====================================\n');
  console.log(`Database ID: ${DATABASE_ID}\n`);

  try {
    // 1. Query all pages
    const pages = await queryAllPages();

    if (pages.length === 0) {
      console.log('✨ Database is already empty. Nothing to delete!');
      process.exit(0);
    }

    // 2. Confirm deletion
    console.log('⚠️  WARNING: This will archive (delete) all pages in the database!');
    console.log(`   Total pages to delete: ${pages.length}\n`);

    // Auto-confirm for script execution
    console.log('🗑️  Proceeding with deletion...\n');

    // 3. Archive all pages
    const results = await archiveAllPages(pages);

    // 4. Print results
    console.log('\n====================================');
    console.log('📊 Cleanup Complete!');
    console.log('====================================\n');
    console.log(`✅ Successfully archived: ${results.success}`);
    console.log(`❌ Failed: ${results.failed}`);

    if (results.failed > 0) {
      console.log(`📈 Success rate: ${((results.success / pages.length) * 100).toFixed(2)}%\n`);

      console.log('Failed pages:');
      results.errors.forEach(({ uploadId, error }) => {
        console.log(`  - ${uploadId}: ${error}`);
      });
      console.log();
    } else {
      console.log(`📈 Success rate: 100.00%\n`);
    }

    console.log('✨ Database cleanup complete!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    logger.logError('Database cleanup failed', error);
    process.exit(1);
  }
}

// Run
main();
