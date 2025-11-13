/**
 * Slack to Google Drive Image Uploader
 * Main Express server
 */

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const database = require('./utils/database');
const validator = require('./utils/validator');
const { createSlackVerificationMiddleware } = require('./middleware/slackVerification');
const slackService = require('./services/slackService');
const driveService = require('./services/driveService');
const queueService = require('./services/queueService');
const notionLogger = require('./services/notionLogger');

// Initialize Express app
const app = express();

// Store processed event IDs to prevent duplicates (1 hour TTL)
const processedEvents = new Set();
const EVENT_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Clean up old event IDs periodically
 */
setInterval(() => {
  processedEvents.clear();
  logger.debug('Cleared processed events cache');
}, EVENT_TTL);

/**
 * Parse JSON bodies
 */
app.use(express.json());

/**
 * Health check endpoint (public - no Slack verification)
 */
app.get('/health', (req, res) => {
  const stats = database.getStats();
  const queueStats = queueService.getQueueStats();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
    queue: {
      pending: queueStats.length,
      processing: queueStats.running,
      idle: queueStats.idle,
      concurrency: queueStats.concurrency,
    },
    stats: {
      totalUploads: stats.total,
      pending: stats.pending,
      processing: stats.processing,
      completed: stats.completed,
      failed: stats.failed,
      successRate: stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(2) : 0,
    },
  });
});

/**
 * Process file upload with retry logic
 * @param {Object} fileInfo - File information from Slack
 * @param {number} attempt - Current attempt number
 */
async function processUploadWithRetry(fileInfo, attempt = 1) {
  const maxAttempts = config.retry.maxAttempts;
  const channelId = fileInfo.channels && fileInfo.channels[0];
  const startTime = Date.now();

  try {
    // Update status to processing
    database.updateUpload(fileInfo.id, {
      status: 'processing',
      retry_count: attempt - 1,
    });

    // Update Notion status to Processing
    if (notionLogger.isEnabled()) {
      notionLogger.updateUploadStatus(fileInfo.id, {
        status: 'Processing',
      }).catch(err => logger.warn('Notion update failed', err));
    }

    logger.info('Processing file upload', {
      fileId: fileInfo.id,
      filename: fileInfo.name,
      attempt,
      maxAttempts,
    });

    // Download file from Slack
    const fileStream = await slackService.downloadFileStream(fileInfo.urlPrivateDownload);

    // Upload to Google Drive
    const driveFile = await driveService.uploadFile(
      fileStream,
      fileInfo.name,
      fileInfo.mimetype
    );

    const processingTime = Date.now() - startTime;

    // Update database with success
    database.updateUpload(fileInfo.id, {
      status: 'completed',
      drive_file_id: driveFile.id,
      drive_file_name: driveFile.name,
      drive_file_url: driveFile.url,
      drive_folder_path: driveFile.folderId,
      uploaded_at: new Date().toISOString(),
    });

    // Update Notion status to Completed
    if (notionLogger.isEnabled()) {
      notionLogger.updateUploadStatus(fileInfo.id, {
        status: 'Completed',
        driveFileId: driveFile.id,
        driveUrl: driveFile.url,
        processingTimeMs: processingTime,
      }).catch(err => logger.warn('Notion update failed', err));
    }

    logger.info('File uploaded successfully', {
      fileId: fileInfo.id,
      driveFileId: driveFile.id,
      driveUrl: driveFile.url,
      processingTime: `${processingTime}ms`,
    });

    // Send completion message to Slack
    if (channelId) {
      await slackService.sendCompletionMessage(channelId, {
        originalFilename: fileInfo.name,
        fileSize: fileInfo.size,
        driveFileUrl: driveFile.url,
      });
    }

  } catch (error) {
    logger.logError(`Upload attempt ${attempt} failed`, error, {
      fileId: fileInfo.id,
      filename: fileInfo.name,
    });

    // Retry with exponential backoff
    if (attempt < maxAttempts) {
      const delay = Math.pow(2, attempt) * config.retry.delayMs;
      logger.info(`Retrying upload after ${delay}ms`, {
        fileId: fileInfo.id,
        attempt: attempt + 1,
        maxAttempts,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
      return processUploadWithRetry(fileInfo, attempt + 1);
    }

    // All retries failed
    database.updateUpload(fileInfo.id, {
      status: 'failed',
      error_message: error.message,
      retry_count: maxAttempts,
    });

    // Update Notion status to Failed
    if (notionLogger.isEnabled()) {
      notionLogger.updateUploadStatus(fileInfo.id, {
        status: 'Failed',
        errorMessage: error.message,
        retryCount: maxAttempts,
      }).catch(err => logger.warn('Notion update failed', err));
    }

    logger.error('Upload failed after all retries', {
      fileId: fileInfo.id,
      filename: fileInfo.name,
      attempts: maxAttempts,
      error: error.message,
    });

    // Send error message to Slack
    if (channelId) {
      await slackService.sendErrorMessage(channelId, {
        originalFilename: fileInfo.name,
      }, error);
    }

    throw error;
  }
}

/**
 * Handle file_shared event
 * @param {Object} event - Slack event
 */
async function handleFileSharedEvent(event) {
  const { file_id, user_id, channel_id } = event;

  try {
    // Check for duplicate
    if (database.fileExists(file_id)) {
      logger.warn('Duplicate file upload attempt', {
        fileId: file_id,
        userId: user_id,
      });
      return;
    }

    // Get file information from Slack
    const fileInfo = await slackService.getFileInfo(file_id);

    // Validate file upload
    const validation = validator.validateFileUpload(fileInfo);
    if (!validation.valid) {
      logger.warn('File validation failed', {
        fileId: file_id,
        errors: validation.errors,
      });

      // Insert failed record
      database.insertUpload({
        slackFileId: file_id,
        slackUserId: user_id,
        channelId: channel_id,
        originalFilename: fileInfo.name || 'unknown',
        fileSize: fileInfo.size,
        mimeType: fileInfo.mimetype,
        status: 'failed',
      });

      database.updateUpload(file_id, {
        error_message: validation.errors.join('; '),
      });

      return;
    }

    // Get user info (optional)
    const userInfo = await slackService.getUserInfo(user_id);

    // Insert into database
    const recordId = database.insertUpload({
      slackFileId: file_id,
      slackUserId: user_id,
      slackUserName: userInfo.name,
      channelId: channel_id,
      originalFilename: fileInfo.name,
      fileSize: fileInfo.size,
      mimeType: fileInfo.mimetype,
      status: 'pending',
    });

    if (!recordId) {
      logger.warn('Failed to create upload record (possible duplicate)', {
        fileId: file_id,
      });
      return;
    }

    // Log to Notion (non-blocking)
    if (notionLogger.isEnabled()) {
      notionLogger.logUpload({
        slackFileId: file_id,
        slackUserId: user_id,
        slackUserName: userInfo.name,
        channelId: channel_id,
        filename: fileInfo.name,
        fileSize: fileInfo.size,
        mimeType: fileInfo.mimetype,
        status: 'Pending',
      }).catch(err => logger.warn('Notion logging failed', err));
    }

    // Add to queue for processing
    await queueService.addUploadTask(fileInfo, async (file) => {
      await processUploadWithRetry(file);
    });

    logger.info('Upload task queued', {
      fileId: file_id,
      recordId,
      queueLength: queueService.getQueueStats().length,
    });

  } catch (error) {
    logger.logError('Error handling file_shared event', error, {
      fileId: file_id,
      userId: user_id,
      channelId: channel_id,
    });
  }
}

/**
 * Slack Events API endpoint (with Slack signature verification)
 */
app.post('/slack/events', createSlackVerificationMiddleware(), async (req, res) => {
  const { type, challenge, event, event_id } = req.body;

  // URL verification (first-time setup)
  if (type === 'url_verification') {
    logger.info('URL verification request received', { challenge });
    return res.json({ challenge });
  }

  // Event callback
  if (type === 'event_callback') {
    // Check for duplicate event
    if (processedEvents.has(event_id)) {
      logger.warn('Duplicate event received', { eventId: event_id });
      return res.status(200).send('OK');
    }

    // Mark event as processed
    processedEvents.add(event_id);

    // Acknowledge immediately (Slack requires response within 3 seconds)
    res.status(200).send('OK');

    // Validate event
    const eventValidation = validator.validateSlackEvent(event);
    if (!eventValidation.valid) {
      logger.warn('Invalid Slack event', {
        eventId: event_id,
        error: eventValidation.error,
      });
      return;
    }

    // Process event in background
    if (event.type === 'file_shared') {
      logger.logSlackEvent('File shared event received', event);

      // Handle asynchronously
      setImmediate(() => {
        handleFileSharedEvent(event).catch(error => {
          logger.logError('Unhandled error in file_shared handler', error, {
            eventId: event_id,
          });
        });
      });
    } else {
      logger.debug('Ignoring non-file event', {
        eventType: event.type,
        eventId: event_id,
      });
    }

    return;
  }

  // Unknown event type
  logger.warn('Unknown event type', { type });
  res.status(400).json({ error: 'Unknown event type' });
});

/**
 * Error handling middleware
 */
app.use((error, req, res, next) => {
  logger.logError('Express error handler', error, {
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: config.server.nodeEnv === 'development' ? error.message : undefined,
  });
});

/**
 * Start server
 */
async function startServer() {
  try {
    // Test Slack connection
    logger.info('Testing Slack connection...');
    await slackService.testConnection();

    // Test Drive connection
    logger.info('Testing Google Drive connection...');
    await driveService.testConnection();

    // Start Express server
    const port = config.server.port;
    app.listen(port, () => {
      logger.info(`Server started successfully`, {
        port,
        nodeEnv: config.server.nodeEnv,
        queueConcurrency: config.queue.concurrency,
        createDateFolders: config.upload.createDateFolders,
      });

      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀  Slack to Google Drive Image Uploader               ║
║                                                           ║
║   Server running on port ${port}                            ║
║   Environment: ${config.server.nodeEnv.padEnd(18)}                    ║
║                                                           ║
║   Endpoints:                                              ║
║   POST /slack/events  - Slack Events API                 ║
║   GET  /health        - Health check                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    logger.logError('Failed to start server', error);
    console.error('\n❌ SERVER STARTUP FAILED:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('\nPlease check:');
    console.error('1. All required environment variables are set');
    console.error('2. SLACK_BOT_TOKEN is valid and starts with "xoxb-"');
    console.error('3. Google Drive folder ID is correct');
    console.error('4. Service account has access to the Drive folder');
    console.error('5. GOOGLE_CREDENTIALS_BASE64 is properly encoded\n');
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, starting graceful shutdown...`);

  try {
    // Stop accepting new requests
    logger.info('Closing server...');

    // Wait for queue to drain
    await queueService.gracefulShutdown(30000);

    // Close database
    database.closeDatabase();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.logError('Error during graceful shutdown', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.logError('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason,
    promise,
  });
});

// Start the server
startServer();
