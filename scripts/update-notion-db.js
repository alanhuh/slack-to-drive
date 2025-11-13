/**
 * Update Notion Database with Properties
 * Use this to add properties to an existing database
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

async function updateDatabase(databaseId) {
  console.log('🔧 Updating Notion database with properties...\n');
  console.log(`Database ID: ${databaseId}\n`);

  try {
    const response = await notion.databases.update({
      database_id: databaseId,
      properties: {
        'Upload ID': {
          title: {},
        },
        'Timestamp': {
          date: {},
        },
        'File Name': {
          rich_text: {},
        },
        'File Size (MB)': {
          number: {
            format: 'number',
          },
        },
        'MIME Type': {
          select: {},
        },
        'Slack User ID': {
          rich_text: {},
        },
        'Slack User Name': {
          rich_text: {},
        },
        'Channel ID': {
          rich_text: {},
        },
        'Drive File ID': {
          rich_text: {},
        },
        'Drive URL': {
          url: {},
        },
        'Status': {
          select: {
            options: [
              { name: 'Pending', color: 'yellow' },
              { name: 'Processing', color: 'blue' },
              { name: 'Completed', color: 'green' },
              { name: 'Failed', color: 'red' },
            ],
          },
        },
        'Error Message': {
          rich_text: {},
        },
        'Retry Count': {
          number: {
            format: 'number',
          },
        },
        'Processing Time (ms)': {
          number: {
            format: 'number',
          },
        },
      },
    });

    console.log('✅ Database updated successfully!\n');
    console.log('🔍 Full response:');
    console.log(JSON.stringify(response, null, 2));
    console.log('\n🔍 Updated properties:');
    console.log(JSON.stringify(response.properties, null, 2));
    console.log('\nNumber of properties:', Object.keys(response.properties || {}).length);
  } catch (error) {
    console.error('❌ Failed to update database:');
    console.error(error.message);
    process.exit(1);
  }
}

// Get database ID from command line
const databaseId = process.argv[2];

if (!databaseId) {
  console.error('❌ Error: Database ID required\n');
  console.error('Usage: node scripts/update-notion-db.js <database-id>\n');
  process.exit(1);
}

updateDatabase(databaseId);
