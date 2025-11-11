/**
 * Diagnostic Script
 * Helps identify startup issues by testing each component individually
 */

require('dotenv').config();

console.log('='.repeat(60));
console.log('DIAGNOSTIC SCRIPT - Slack to Drive Uploader');
console.log('='.repeat(60));
console.log();

// Test 1: Environment Variables
console.log('1. Checking environment variables...');
const requiredVars = [
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID',
];

const optionalVars = [
  'GOOGLE_CREDENTIALS_BASE64',
  'GOOGLE_CREDENTIALS_PATH',
  'PORT',
  'NODE_ENV',
];

let envCheckPassed = true;
requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    console.log(`   ❌ ${varName}: MISSING`);
    envCheckPassed = false;
  } else {
    const display = varName.includes('TOKEN') || varName.includes('SECRET')
      ? `${value.substring(0, 10)}...`
      : value;
    console.log(`   ✓ ${varName}: ${display}`);
  }
});

console.log('\n   Optional variables:');
optionalVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    const display = varName.includes('BASE64')
      ? `${value.substring(0, 20)}... (length: ${value.length})`
      : value;
    console.log(`   ✓ ${varName}: ${display}`);
  } else {
    console.log(`   - ${varName}: not set`);
  }
});
console.log();

if (!envCheckPassed) {
  console.log('❌ Environment check failed. Fix missing variables and try again.');
  process.exit(1);
}

// Test 2: Config Loading
console.log('2. Loading configuration...');
try {
  const config = require('./config');
  console.log(`   ✓ Config loaded successfully`);
  console.log(`   - Port: ${config.server.port}`);
  console.log(`   - Node Env: ${config.server.nodeEnv}`);
  console.log(`   - Drive Folder ID: ${config.drive.folderId}`);
  console.log(`   - Credentials method: ${config.drive.credentialsBase64 ? 'base64' : 'file'}`);
  console.log();
} catch (error) {
  console.log(`   ❌ Config loading failed: ${error.message}`);
  console.log();
  console.log('Full error:');
  console.error(error);
  process.exit(1);
}

// Test 3: Database
console.log('3. Testing database...');
try {
  const database = require('./utils/database');
  const stats = database.getStats();
  console.log(`   ✓ Database initialized`);
  console.log(`   - Total records: ${stats.total}`);
  console.log();
} catch (error) {
  console.log(`   ❌ Database initialization failed: ${error.message}`);
  console.log();
  console.log('Full error:');
  console.error(error);
  process.exit(1);
}

// Test 4: Slack Connection
console.log('4. Testing Slack connection...');
const slackService = require('./services/slackService');
slackService.testConnection()
  .then(result => {
    console.log(`   ✓ Slack connection successful`);
    console.log(`   - Team: ${result.team}`);
    console.log(`   - User: ${result.user}`);
    console.log(`   - Bot ID: ${result.botId}`);
    console.log();

    // Test 5: Google Drive Connection
    console.log('5. Testing Google Drive connection...');
    const driveService = require('./services/driveService');
    return driveService.testConnection();
  })
  .then(() => {
    console.log(`   ✓ Google Drive connection successful`);
    console.log();

    console.log('='.repeat(60));
    console.log('✓ ALL TESTS PASSED');
    console.log('='.repeat(60));
    console.log();
    console.log('Your server should start successfully now!');
    console.log('Run: npm start');
    console.log();
    process.exit(0);
  })
  .catch(error => {
    console.log(`   ❌ Connection test failed: ${error.message}`);
    console.log();
    console.log('Full error:');
    console.error(error);
    console.log();
    console.log('='.repeat(60));
    console.log('DIAGNOSIS COMPLETE - ISSUES FOUND');
    console.log('='.repeat(60));
    console.log();
    console.log('Please fix the errors above and try again.');
    process.exit(1);
  });
