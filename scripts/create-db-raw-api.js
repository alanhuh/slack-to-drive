/**
 * Create Notion Database using raw REST API
 */

require('dotenv').config();
const https = require('https');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PARENT_PAGE_ID = process.argv[2];

if (!PARENT_PAGE_ID) {
  console.error('❌ Usage: node scripts/create-db-raw-api.js <parent-page-id>');
  process.exit(1);
}

const data = JSON.stringify({
  parent: {
    type: 'page_id',
    page_id: PARENT_PAGE_ID,
  },
  title: [
    {
      type: 'text',
      text: {
        content: '📤 Slack Upload Log',
      },
    },
  ],
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

console.log('📤 Sending request to Notion API...\n');
console.log('Request body:');
console.log(data);
console.log('\n');

const options = {
  hostname: 'api.notion.com',
  path: '/v1/databases',
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
    console.log(`Status Code: ${res.statusCode}\n`);
    console.log('Response:');
    const parsed = JSON.parse(responseData);
    console.log(JSON.stringify(parsed, null, 2));

    if (res.statusCode === 200) {
      console.log('\n✅ Database created!');
      console.log(`Database ID: ${parsed.id}`);
      console.log(`URL: https://notion.so/${parsed.id.replace(/-/g, '')}`);

      if (parsed.properties) {
        console.log(`\nProperties: ${Object.keys(parsed.properties).length}`);
        console.log('Property names:', Object.keys(parsed.properties).join(', '));
      } else {
        console.log('\n⚠️ No properties in response');
      }
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error);
});

req.write(data);
req.end();
