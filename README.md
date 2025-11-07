# Slack to Google Drive Image Uploader

Automatically upload images from Slack to Google Drive with this production-ready Node.js server.

## Features

- ✅ Automatic image upload from Slack to Google Drive
- ✅ Service Account authentication (no OAuth needed)
- ✅ Date-based folder organization (YYYY-MM-DD)
- ✅ Duplicate filename handling with timestamps
- ✅ File validation (size, type, user)
- ✅ Queue system with concurrency control
- ✅ Retry logic with exponential backoff
- ✅ SQLite database for upload history
- ✅ Comprehensive logging with Winston
- ✅ Slack signature verification
- ✅ Success/error notifications in Slack
- ✅ Health check endpoint
- ✅ Graceful shutdown

## Prerequisites

### 1. Node.js
- Node.js 18+ (LTS recommended)
- npm or yarn

### 2. Slack App Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Enter app name and select workspace

#### OAuth & Permissions
Navigate to **OAuth & Permissions** and add these **Bot Token Scopes**:
- `files:read` - Read file information
- `users:read` - Read user information
- `chat:write` - Send messages

#### Event Subscriptions
1. Navigate to **Event Subscriptions**
2. Enable Events
3. Set **Request URL**: `https://your-domain.com/slack/events`
   - For local development, use ngrok (see below)
4. Subscribe to **bot events**:
   - `file_shared` - Triggered when files are shared

#### Install App
1. Navigate to **Install App**
2. Click **"Install to Workspace"**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### App Credentials
Navigate to **Basic Information** and copy:
- **Signing Secret**

### 3. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Google Drive API**:
   - Navigate to **APIs & Services** → **Library**
   - Search for "Google Drive API"
   - Click **Enable**

#### Create Service Account
1. Navigate to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Enter name and description
4. Click **Create and Continue**
5. Skip optional steps and click **Done**

#### Create JSON Key
1. Click on the created service account
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Choose **JSON**
5. Download the key file → Save as `config/google-credentials.json`

#### Share Drive Folder
1. Create or open target folder in Google Drive
2. Copy the **Folder ID** from URL:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```
3. Click **Share** on the folder
4. Add the service account email (from JSON key: `client_email`)
5. Give **Editor** permission

## Installation

### 1. Clone or Download

```bash
cd slack_img_automation
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Slack Configuration
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# Target User (Optional - leave empty to accept all users)
TARGET_USER_ID=

# Google Drive Configuration
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id_here

# File Upload Settings
MAX_FILE_SIZE_MB=50
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/gif,image/webp,image/bmp
CREATE_DATE_FOLDERS=true

# Retry Configuration
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=2000

# Queue Configuration
QUEUE_CONCURRENCY=3

# Notification Settings
SEND_COMPLETION_MESSAGE=true
SEND_ERROR_MESSAGE=true
```

### 4. Add Google Credentials

Place your Google Service Account JSON key at:
```
config/google-credentials.json
```

**Important**: This file contains sensitive credentials. Never commit it to Git!

## Usage

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Using ngrok for Local Development

Slack requires HTTPS for webhooks. Use ngrok to create a secure tunnel:

1. Install ngrok: [https://ngrok.com/download](https://ngrok.com/download)

2. Start your server:
   ```bash
   npm run dev
   ```

3. In another terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

5. Update Slack Event Subscriptions Request URL:
   ```
   https://abc123.ngrok.io/slack/events
   ```

## How It Works

### Workflow

```
1. User uploads image in Slack
   ↓
2. Slack sends file_shared event to /slack/events
   ↓
3. Server validates Slack signature (security)
   ↓
4. Server responds 200 OK immediately (< 3 seconds)
   ↓
5. Background processing starts
   ↓
6. Get file info from Slack API
   ↓
7. Validate file (type, size, user)
   ↓
8. Create database record (status: pending)
   ↓
9. Add to processing queue
   ↓
10. Download image from Slack (stream)
    ↓
11. Upload to Google Drive (stream)
    ↓
12. Update database (status: completed)
    ↓
13. Send success message to Slack
```

### Folder Structure

If `CREATE_DATE_FOLDERS=true`, files are organized by date:

```
Your Drive Folder/
├── 2024-11-07/
│   ├── image1.png
│   ├── screenshot_20241107143022.png
│   └── photo.jpg
├── 2024-11-08/
│   ├── diagram.png
│   └── chart.jpg
```

### Duplicate Filenames

If a file with the same name exists, a timestamp is added:

```
Original: image.png
Duplicate: image_20241107143022.png
```

## API Endpoints

### POST /slack/events

Receives Slack Events API webhooks.

**Headers:**
- `X-Slack-Signature` - Request signature
- `X-Slack-Request-Timestamp` - Request timestamp

**Response:**
- `200 OK` - Event accepted
- `401 Unauthorized` - Invalid signature
- `400 Bad Request` - Invalid payload

### GET /health

Health check endpoint with statistics.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-07T14:30:22Z",
  "uptime": 12345,
  "database": "connected",
  "queue": {
    "pending": 2,
    "processing": 1,
    "idle": false,
    "concurrency": 3
  },
  "stats": {
    "totalUploads": 150,
    "pending": 2,
    "processing": 1,
    "completed": 145,
    "failed": 2,
    "successRate": "96.67"
  }
}
```

## Database

SQLite database is automatically created at `data/uploads.db`.

### Schema

```sql
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_file_id TEXT NOT NULL UNIQUE,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT,
  channel_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  drive_file_id TEXT,
  drive_file_name TEXT,
  drive_file_url TEXT,
  drive_folder_path TEXT,
  status TEXT NOT NULL,              -- pending/processing/completed/failed
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  uploaded_at DATETIME
);
```

## Logging

Logs are stored in the `logs/` directory:

- `combined.log` - All logs
- `error.log` - Error logs only
- `exceptions.log` - Uncaught exceptions
- `rejections.log` - Unhandled promise rejections

Log levels: `error`, `warn`, `info`, `debug`

Set log level in `.env`:
```env
LOG_LEVEL=info
```

## Configuration Options

### File Upload

```env
# Maximum file size in megabytes (1-1000)
MAX_FILE_SIZE_MB=50

# Allowed image MIME types (comma-separated)
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/gif,image/webp,image/bmp

# Create date-based folders (true/false)
CREATE_DATE_FOLDERS=true
```

### Queue

```env
# Number of concurrent uploads (1-10)
QUEUE_CONCURRENCY=3
```

### Retry

```env
# Maximum retry attempts for failed uploads (1-10)
MAX_RETRY_ATTEMPTS=3

# Base delay between retries in milliseconds
# Uses exponential backoff: 2^attempt * RETRY_DELAY_MS
RETRY_DELAY_MS=2000
```

### Notifications

```env
# Send success message to Slack (true/false)
SEND_COMPLETION_MESSAGE=true

# Send error message to Slack (true/false)
SEND_ERROR_MESSAGE=true
```

### User Filtering

To only accept uploads from a specific user:

```env
TARGET_USER_ID=U123456789
```

Leave empty to accept all users.

## Troubleshooting

### Slack Events Not Received

**Symptom**: No events arriving at `/slack/events`

**Solutions**:
1. Check Request URL in Slack Event Subscriptions
2. Verify server is running and accessible
3. Check ngrok tunnel is active (for local dev)
4. Review server logs for errors
5. Ensure Slack app is installed in workspace

### Invalid Slack Signature

**Symptom**: `401 Unauthorized` errors in logs

**Solutions**:
1. Verify `SLACK_SIGNING_SECRET` in `.env`
2. Check server time is accurate (prevents replay attacks)
3. Ensure raw body is being captured correctly

### Google Drive Upload Failed

**Symptom**: Files download from Slack but fail to upload

**Solutions**:
1. Verify `config/google-credentials.json` exists
2. Check Google Drive API is enabled in Cloud Console
3. Confirm service account has Editor permission on folder
4. Verify `GOOGLE_DRIVE_FOLDER_ID` is correct
5. Check service account email matches JSON key

### File Validation Failed

**Symptom**: Files are ignored or marked as failed

**Solutions**:
1. Check file MIME type is in `ALLOWED_IMAGE_TYPES`
2. Verify file size is under `MAX_FILE_SIZE_MB`
3. If `TARGET_USER_ID` is set, ensure user matches
4. Review validation errors in logs

### Queue Stuck

**Symptom**: Files remain in "processing" status

**Solutions**:
1. Check `GET /health` endpoint queue stats
2. Review error logs for stuck tasks
3. Restart server to clear queue
4. Reduce `QUEUE_CONCURRENCY` if overwhelmed

## Production Deployment

### Environment Variables

Set `NODE_ENV=production` in production:

```env
NODE_ENV=production
LOG_LEVEL=warn
```

### Process Manager

Use PM2 to keep server running:

```bash
npm install -g pm2

pm2 start server.js --name slack-to-drive
pm2 save
pm2 startup
```

### Reverse Proxy

Use nginx to proxy requests:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL Certificate

Use Let's Encrypt for HTTPS:

```bash
sudo certbot --nginx -d your-domain.com
```

## Security Best Practices

1. **Never commit secrets**
   - Add `.env` to `.gitignore`
   - Never commit `google-credentials.json`

2. **Use environment variables**
   - Store all secrets in `.env`
   - Use different values for dev/production

3. **Enable signature verification**
   - Always validate Slack signatures
   - Reject requests older than 5 minutes

4. **Limit file access**
   - Set `TARGET_USER_ID` if needed
   - Validate all file types and sizes

5. **Use HTTPS**
   - Required for Slack webhooks
   - Use ngrok (dev) or SSL certificate (prod)

6. **Monitor logs**
   - Regularly review error logs
   - Set up alerts for failures

## Development

### Project Structure

```
slack_img_automation/
├── config/
│   ├── index.js                 # Configuration management
│   └── google-credentials.json  # Google Service Account key (gitignored)
├── services/
│   ├── slackService.js          # Slack API interactions
│   ├── driveService.js          # Google Drive API interactions
│   └── queueService.js          # Async queue management
├── utils/
│   ├── logger.js                # Winston logger
│   ├── database.js              # SQLite database
│   └── validator.js             # Input validation
├── middleware/
│   └── slackVerification.js     # Slack signature verification
├── logs/                         # Log files (auto-created)
├── data/                         # Database files (auto-created)
├── server.js                     # Main Express server
├── package.json
├── .env                          # Environment variables (gitignored)
├── .env.example                  # Environment template
└── README.md
```

### Testing

Test Slack connection:
```javascript
const slackService = require('./services/slackService');
await slackService.testConnection();
```

Test Google Drive connection:
```javascript
const driveService = require('./services/driveService');
await driveService.testConnection();
```

## License

MIT

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs in `logs/`
3. Check Slack Event Subscriptions status
4. Verify Google Drive permissions

## Credits

Built with:
- [Express.js](https://expressjs.com/) - Web framework
- [@slack/web-api](https://www.npmjs.com/package/@slack/web-api) - Slack API client
- [googleapis](https://www.npmjs.com/package/googleapis) - Google Drive API
- [Winston](https://www.npmjs.com/package/winston) - Logging
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) - SQLite database
- [async](https://www.npmjs.com/package/async) - Queue management
