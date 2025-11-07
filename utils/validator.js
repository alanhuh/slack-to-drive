/**
 * Input Validation Utilities
 * Validates file uploads, user permissions, and data integrity
 */

const config = require('../config');
const logger = require('./logger');

/**
 * Validate file size
 * @param {number} fileSize - File size in bytes
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateFileSize(fileSize) {
  if (typeof fileSize !== 'number' || fileSize <= 0) {
    return {
      valid: false,
      error: 'Invalid file size',
    };
  }

  if (fileSize > config.upload.maxFileSizeBytes) {
    const maxMB = config.upload.maxFileSizeMB;
    const actualMB = (fileSize / 1024 / 1024).toFixed(2);
    return {
      valid: false,
      error: `File size (${actualMB}MB) exceeds maximum allowed size (${maxMB}MB)`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate MIME type
 * @param {string} mimeType - File MIME type
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') {
    return {
      valid: false,
      error: 'Invalid MIME type',
    };
  }

  if (!config.upload.allowedImageTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `MIME type "${mimeType}" is not allowed. Allowed types: ${config.upload.allowedImageTypes.join(', ')}`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate user ID
 * @param {string} userId - Slack user ID
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    return {
      valid: false,
      error: 'Invalid user ID',
    };
  }

  // Slack user IDs start with 'U' or 'W'
  if (!userId.match(/^[UW][A-Z0-9]{8,}$/)) {
    return {
      valid: false,
      error: `Invalid Slack user ID format: ${userId}`,
    };
  }

  // Check if user is in target list (if configured)
  if (config.slack.targetUserId && userId !== config.slack.targetUserId) {
    return {
      valid: false,
      error: `User ${userId} is not authorized to upload files`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate file ID
 * @param {string} fileId - Slack file ID
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') {
    return {
      valid: false,
      error: 'Invalid file ID',
    };
  }

  // Slack file IDs start with 'F'
  if (!fileId.match(/^F[A-Z0-9]{8,}$/)) {
    return {
      valid: false,
      error: `Invalid Slack file ID format: ${fileId}`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate channel ID
 * @param {string} channelId - Slack channel ID
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateChannelId(channelId) {
  if (!channelId || typeof channelId !== 'string') {
    return {
      valid: false,
      error: 'Invalid channel ID',
    };
  }

  // Slack channel IDs start with 'C', 'D', or 'G'
  if (!channelId.match(/^[CDG][A-Z0-9]{8,}$/)) {
    return {
      valid: false,
      error: `Invalid Slack channel ID format: ${channelId}`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate filename
 * @param {string} filename - Original filename
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return {
      valid: false,
      error: 'Invalid filename',
    };
  }

  // Check for dangerous characters
  const dangerousChars = /[<>:"|?*\x00-\x1f]/;
  if (dangerousChars.test(filename)) {
    return {
      valid: false,
      error: 'Filename contains invalid characters',
    };
  }

  // Check filename length
  if (filename.length > 255) {
    return {
      valid: false,
      error: 'Filename is too long (max 255 characters)',
    };
  }

  return { valid: true, error: null };
}

/**
 * Validate complete file upload data
 * @param {Object} fileInfo - File information from Slack
 * @returns {Object} - { valid: boolean, errors: Array<string> }
 */
function validateFileUpload(fileInfo) {
  const errors = [];

  // Validate file ID
  const fileIdCheck = validateFileId(fileInfo.id);
  if (!fileIdCheck.valid) {
    errors.push(fileIdCheck.error);
  }

  // Validate user ID
  const userIdCheck = validateUserId(fileInfo.user);
  if (!userIdCheck.valid) {
    errors.push(userIdCheck.error);
  }

  // Validate filename
  const filenameCheck = validateFilename(fileInfo.name);
  if (!filenameCheck.valid) {
    errors.push(filenameCheck.error);
  }

  // Validate MIME type
  const mimeTypeCheck = validateMimeType(fileInfo.mimetype);
  if (!mimeTypeCheck.valid) {
    errors.push(mimeTypeCheck.error);
  }

  // Validate file size
  const fileSizeCheck = validateFileSize(fileInfo.size);
  if (!fileSizeCheck.valid) {
    errors.push(fileSizeCheck.error);
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger.warn('File upload validation failed', {
      fileId: fileInfo.id,
      errors,
    });
  }

  return { valid, errors };
}

/**
 * Validate Slack event payload
 * @param {Object} event - Slack event
 * @returns {Object} - { valid: boolean, error: string|null }
 */
function validateSlackEvent(event) {
  if (!event || typeof event !== 'object') {
    return {
      valid: false,
      error: 'Invalid event object',
    };
  }

  if (!event.type) {
    return {
      valid: false,
      error: 'Event type is missing',
    };
  }

  if (event.type === 'file_shared') {
    if (!event.file_id) {
      return {
        valid: false,
        error: 'File ID is missing from file_shared event',
      };
    }

    if (!event.user_id) {
      return {
        valid: false,
        error: 'User ID is missing from file_shared event',
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Sanitize filename for safe storage
 * @param {string} filename - Original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'unnamed-file';

  // Replace dangerous characters with underscores
  let sanitized = filename.replace(/[<>:"|?*\x00-\x1f]/g, '_');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Ensure it's not empty
  if (!sanitized) {
    sanitized = 'unnamed-file';
  }

  // Truncate if too long
  if (sanitized.length > 255) {
    const ext = sanitized.slice(sanitized.lastIndexOf('.'));
    const base = sanitized.slice(0, 255 - ext.length);
    sanitized = base + ext;
  }

  return sanitized;
}

/**
 * Check if file is an image based on MIME type
 * @param {string} mimeType - File MIME type
 * @returns {boolean}
 */
function isImage(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

module.exports = {
  validateFileSize,
  validateMimeType,
  validateUserId,
  validateFileId,
  validateChannelId,
  validateFilename,
  validateFileUpload,
  validateSlackEvent,
  sanitizeFilename,
  isImage,
};
