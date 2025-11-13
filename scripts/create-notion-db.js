/**
 * Create Notion Upload Log Database
 * Run once to set up Notion logging
 */

require('dotenv').config();
const notionLogger = require('../services/notionLogger');

async function main() {
  console.log('🚀 Creating Notion Upload Log Database...\n');

  // Check if API key is provided
  if (!process.env.NOTION_API_KEY) {
    console.error('❌ Error: NOTION_API_KEY not found in .env file');
    console.error('\nPlease add the following to your .env file:');
    console.error('NOTION_API_KEY=secret_your_api_key_here\n');
    process.exit(1);
  }

  // Get parent page ID from user
  const parentPageId = process.argv[2];

  if (!parentPageId) {
    console.error('❌ Error: Parent page ID required\n');
    console.error('Usage: node scripts/create-notion-db.js <parent-page-id>\n');
    console.error('To get your parent page ID:');
    console.error('1. Open a Notion page where you want the database');
    console.error('2. Copy the page URL: https://notion.so/Your-Page-XXXXXXXXX');
    console.error('3. The page ID is the last part: XXXXXXXXX\n');
    process.exit(1);
  }

  try {
    // Remove dashes from page ID if present
    const cleanPageId = parentPageId.replace(/-/g, '');

    console.log('Creating database...');
    console.log(`Parent page ID: ${cleanPageId}\n`);

    const databaseId = await notionLogger.createUploadLogDatabase(cleanPageId);

    console.log('\n✅ Success! Database created.');
    console.log('\n📝 Next steps:');
    console.log('1. Share the database with your integration:');
    console.log('   - Open the database in Notion');
    console.log('   - Click "..." → Add connections → Select your integration');
    console.log('\n2. Update your Render environment variables:');
    console.log('   ENABLE_NOTION_LOGGING=true');
    console.log(`   NOTION_UPLOAD_LOG_DB_ID=${databaseId}`);
    console.log('   NOTION_API_KEY=secret_your_api_key_here\n');

  } catch (error) {
    console.error('\n❌ Failed to create database:');
    console.error(error.message);
    console.error('\nCommon issues:');
    console.error('1. Invalid NOTION_API_KEY');
    console.error('2. Invalid parent page ID format');
    console.error('3. Integration does not have access to the parent page\n');
    process.exit(1);
  }
}

main();
