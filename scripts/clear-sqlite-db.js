/**
 * Clear SQLite Upload Records
 *
 * SQLite 데이터베이스의 업로드 기록을 삭제하는 스크립트
 *
 * Usage:
 *   node scripts/clear-sqlite-db.js
 */

require('dotenv').config();
const database = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Main function
 */
async function main() {
  console.log('🧹 SQLite Database Cleanup Script');
  console.log('====================================\n');

  try {
    // Get count before deletion
    const beforeCount = database.db.prepare('SELECT COUNT(*) as count FROM uploads').get();
    console.log(`📊 Current upload records: ${beforeCount.count}\n`);

    if (beforeCount.count === 0) {
      console.log('✨ Database is already empty. Nothing to delete!');
      process.exit(0);
    }

    // Confirm deletion
    console.log('⚠️  WARNING: This will delete all upload records from SQLite database!\n');
    console.log('🗑️  Proceeding with deletion...\n');

    // Delete all records
    const deleteStmt = database.db.prepare('DELETE FROM uploads');
    const result = deleteStmt.run();

    console.log('====================================');
    console.log('📊 Cleanup Complete!');
    console.log('====================================\n');
    console.log(`✅ Successfully deleted: ${result.changes} records\n`);

    // Verify deletion
    const afterCount = database.db.prepare('SELECT COUNT(*) as count FROM uploads').get();
    console.log(`📊 Remaining records: ${afterCount.count}\n`);

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
