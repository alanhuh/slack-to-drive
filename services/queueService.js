/**
 * Queue Service
 * Manages asynchronous file upload tasks with concurrency control
 */

const async = require('async');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Upload queue with concurrency control
 */
const uploadQueue = async.queue(async (task) => {
  const { fileInfo, processFunction } = task;

  try {
    logger.info('Processing upload from queue', {
      fileId: fileInfo.id,
      userId: fileInfo.user,
      queueLength: uploadQueue.length(),
    });

    await processFunction(fileInfo);

    logger.info('Upload completed successfully', {
      fileId: fileInfo.id,
      queueLength: uploadQueue.length(),
    });
  } catch (error) {
    logger.logError('Upload failed in queue', error, {
      fileId: fileInfo.id,
      userId: fileInfo.user,
    });
    throw error; // Re-throw for queue error handler
  }
}, config.queue.concurrency);

/**
 * Queue event handlers
 */

// When all tasks are completed
uploadQueue.drain(() => {
  logger.info('All upload tasks completed', {
    processed: uploadQueue.workersList().length,
  });
});

// When queue becomes saturated (reaches concurrency limit)
uploadQueue.saturated(() => {
  logger.warn('Upload queue is saturated', {
    queueLength: uploadQueue.length(),
    concurrency: config.queue.concurrency,
  });
});

// When queue becomes empty
uploadQueue.empty(() => {
  logger.debug('Upload queue is empty');
});

// When an error occurs
uploadQueue.error((error, task) => {
  logger.logError('Queue task error', error, {
    fileId: task?.fileInfo?.id,
    userId: task?.fileInfo?.user,
  });
});

/**
 * Add upload task to queue
 * @param {Object} fileInfo - File information from Slack
 * @param {Function} processFunction - Async function to process the upload
 * @returns {Promise} - Resolves when task is queued
 */
function addUploadTask(fileInfo, processFunction) {
  return new Promise((resolve, reject) => {
    uploadQueue.push(
      { fileInfo, processFunction },
      (error) => {
        if (error) {
          logger.logError('Failed to add task to queue', error, {
            fileId: fileInfo.id,
          });
          reject(error);
        } else {
          logger.debug('Task added to queue', {
            fileId: fileInfo.id,
            queueLength: uploadQueue.length(),
          });
          resolve();
        }
      }
    );
  });
}

/**
 * Get queue statistics
 * @returns {Object} - Queue statistics
 */
function getQueueStats() {
  return {
    length: uploadQueue.length(),
    running: uploadQueue.running(),
    idle: uploadQueue.idle(),
    concurrency: config.queue.concurrency,
    paused: uploadQueue.paused,
  };
}

/**
 * Pause the queue
 */
function pauseQueue() {
  uploadQueue.pause();
  logger.info('Upload queue paused');
}

/**
 * Resume the queue
 */
function resumeQueue() {
  uploadQueue.resume();
  logger.info('Upload queue resumed');
}

/**
 * Kill the queue (remove all tasks and stop processing)
 */
function killQueue() {
  uploadQueue.kill();
  logger.warn('Upload queue killed - all pending tasks removed');
}

/**
 * Remove specific task from queue by file ID
 * @param {string} fileId - Slack file ID
 * @returns {boolean} - True if task was removed
 */
function removeTask(fileId) {
  const removed = uploadQueue.remove((task) => {
    return task.data.fileInfo.id === fileId;
  });

  if (removed.length > 0) {
    logger.info('Task removed from queue', {
      fileId,
      removedCount: removed.length,
    });
    return true;
  }

  return false;
}

/**
 * Get pending tasks in queue
 * @returns {Array} - Array of pending task info
 */
function getPendingTasks() {
  const tasks = [];

  uploadQueue.workersList().forEach((worker) => {
    if (worker.data) {
      tasks.push({
        fileId: worker.data.fileInfo.id,
        userId: worker.data.fileInfo.user,
        filename: worker.data.fileInfo.name,
      });
    }
  });

  return tasks;
}

/**
 * Wait for queue to drain (complete all tasks)
 * @param {number} timeout - Timeout in milliseconds (0 = no timeout)
 * @returns {Promise} - Resolves when queue is empty
 */
function waitForDrain(timeout = 0) {
  return new Promise((resolve, reject) => {
    if (uploadQueue.idle()) {
      resolve();
      return;
    }

    let timeoutId;

    const drainHandler = () => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve();
    };

    uploadQueue.drain(drainHandler);

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        uploadQueue.drain(() => {}); // Remove drain handler
        reject(new Error(`Queue drain timeout after ${timeout}ms`));
      }, timeout);
    }
  });
}

/**
 * Gracefully shutdown queue
 * Waits for current tasks to complete, then stops accepting new tasks
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise}
 */
async function gracefulShutdown(timeout = 30000) {
  logger.info('Starting graceful queue shutdown', {
    pendingTasks: uploadQueue.length(),
    runningTasks: uploadQueue.running(),
  });

  // Stop accepting new tasks
  pauseQueue();

  try {
    // Wait for existing tasks to complete
    await waitForDrain(timeout);
    logger.info('Queue shutdown completed successfully');
  } catch (error) {
    logger.warn('Queue shutdown timeout - killing remaining tasks', {
      remainingTasks: uploadQueue.length(),
    });
    killQueue();
  }
}

module.exports = {
  addUploadTask,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  killQueue,
  removeTask,
  getPendingTasks,
  waitForDrain,
  gracefulShutdown,
};
