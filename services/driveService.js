/**
 * Google Drive Service
 * Handles file uploads to Google Drive with Service Account authentication
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { sanitizeFilename } = require('../utils/validator');

let driveClient = null;

/**
 * Initialize Google Drive client with Service Account
 * @returns {Object} - Google Drive API client
 */
function initializeDriveClient() {
  if (driveClient) {
    return driveClient;
  }

  try {
    // Load service account credentials
    let credentials;

    // Check if credentials are provided as base64 (for Render/cloud deployment)
    if (config.drive.credentialsBase64) {
      logger.info('Loading Google credentials from base64 environment variable');
      const credentialsJson = Buffer.from(config.drive.credentialsBase64, 'base64').toString('utf8');
      credentials = JSON.parse(credentialsJson);
    } else {
      // Load from file (for local development)
      const credentialsPath = path.resolve(config.drive.credentialsPath);

      if (!fs.existsSync(credentialsPath)) {
        throw new Error(`Google credentials file not found at: ${credentialsPath}`);
      }

      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    }

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ],
    });

    // Create Drive client
    driveClient = google.drive({ version: 'v3', auth });

    logger.info('Google Drive client initialized', {
      serviceAccount: credentials.client_email,
    });

    return driveClient;
  } catch (error) {
    logger.logError('Failed to initialize Google Drive client', error);
    throw error;
  }
}

/**
 * Get or create date-based folder
 * @param {string} parentFolderId - Parent folder ID
 * @param {Date} date - Date for folder name
 * @returns {Promise<string>} - Folder ID
 */
async function getOrCreateDateFolder(parentFolderId, date = new Date()) {
  const drive = initializeDriveClient();

  // Format date as YYYY-MM-DD
  const folderName = date.toISOString().split('T')[0];

  try {
    // Search for existing folder
    const response = await drive.files.list({
      q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (response.data.files && response.data.files.length > 0) {
      const folderId = response.data.files[0].id;
      logger.debug('Found existing date folder', {
        folderName,
        folderId,
      });
      return folderId;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, name',
    });

    const folderId = createResponse.data.id;
    logger.info('Created new date folder', {
      folderName,
      folderId,
    });

    return folderId;
  } catch (error) {
    logger.logError('Failed to get/create date folder', error, {
      parentFolderId,
      folderName,
    });
    throw error;
  }
}

/**
 * Generate unique filename if file exists
 * @param {string} folderId - Drive folder ID
 * @param {string} filename - Original filename
 * @returns {Promise<string>} - Unique filename
 */
async function generateUniqueFilename(folderId, filename) {
  const drive = initializeDriveClient();

  try {
    // Check if file exists
    const response = await drive.files.list({
      q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (!response.data.files || response.data.files.length === 0) {
      // File doesn't exist, use original name
      return filename;
    }

    // File exists, generate unique name with timestamp
    const timestamp = new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .slice(0, 14); // YYYYMMDDHHmmss

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);

    const uniqueFilename = `${base}_${timestamp}${ext}`;

    logger.debug('Generated unique filename', {
      original: filename,
      unique: uniqueFilename,
    });

    return uniqueFilename;
  } catch (error) {
    logger.logError('Failed to check file existence', error, {
      folderId,
      filename,
    });
    // On error, use timestamped name to be safe
    const timestamp = Date.now();
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    return `${base}_${timestamp}${ext}`;
  }
}

/**
 * Upload file to Google Drive from stream
 * @param {Stream} fileStream - Readable stream of file data
 * @param {string} filename - Original filename
 * @param {string} mimeType - File MIME type
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Uploaded file metadata
 */
async function uploadFile(fileStream, filename, mimeType, options = {}) {
  const drive = initializeDriveClient();

  try {
    // Sanitize filename
    const sanitized = sanitizeFilename(filename);

    // Determine target folder
    let targetFolderId = config.drive.folderId;

    if (config.upload.createDateFolders) {
      targetFolderId = await getOrCreateDateFolder(config.drive.folderId);
    }

    // Generate unique filename if needed
    const uniqueFilename = await generateUniqueFilename(targetFolderId, sanitized);

    logger.info('Uploading file to Drive', {
      filename: uniqueFilename,
      folderId: targetFolderId,
      mimeType,
    });

    // Upload file
    const response = await drive.files.create({
      requestBody: {
        name: uniqueFilename,
        parents: [targetFolderId],
        mimeType: mimeType,
      },
      media: {
        mimeType: mimeType,
        body: fileStream,
      },
      fields: 'id, name, webViewLink, webContentLink, size, mimeType',
    });

    const fileData = response.data;

    logger.info('File uploaded successfully to Drive', {
      fileId: fileData.id,
      filename: fileData.name,
      size: fileData.size,
      url: fileData.webViewLink,
    });

    return {
      id: fileData.id,
      name: fileData.name,
      url: fileData.webViewLink,
      downloadUrl: fileData.webContentLink,
      size: parseInt(fileData.size, 10),
      mimeType: fileData.mimeType,
      folderId: targetFolderId,
    };
  } catch (error) {
    logger.logError('Failed to upload file to Drive', error, {
      filename,
      mimeType,
    });
    throw error;
  }
}

/**
 * Delete file from Google Drive
 * @param {string} fileId - Drive file ID
 * @returns {Promise<boolean>} - Success status
 */
async function deleteFile(fileId) {
  const drive = initializeDriveClient();

  try {
    await drive.files.delete({
      fileId: fileId,
    });

    logger.info('File deleted from Drive', { fileId });
    return true;
  } catch (error) {
    logger.logError('Failed to delete file from Drive', error, { fileId });
    throw error;
  }
}

/**
 * Get file metadata from Google Drive
 * @param {string} fileId - Drive file ID
 * @returns {Promise<Object>} - File metadata
 */
async function getFileMetadata(fileId) {
  const drive = initializeDriveClient();

  try {
    const response = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, webViewLink, webContentLink, createdTime',
    });

    return response.data;
  } catch (error) {
    logger.logError('Failed to get file metadata from Drive', error, { fileId });
    throw error;
  }
}

/**
 * List files in a folder
 * @param {string} folderId - Drive folder ID
 * @param {number} limit - Maximum number of files to return
 * @returns {Promise<Array>} - Array of file metadata
 */
async function listFiles(folderId, limit = 100) {
  const drive = initializeDriveClient();

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, webViewLink, createdTime)',
      pageSize: limit,
      orderBy: 'createdTime desc',
    });

    return response.data.files || [];
  } catch (error) {
    logger.logError('Failed to list files in folder', error, { folderId });
    throw error;
  }
}

/**
 * Test Drive connection and permissions
 * @returns {Promise<boolean>} - Success status
 */
async function testConnection() {
  const drive = initializeDriveClient();

  try {
    // Try to get metadata for the target folder
    const response = await drive.files.get({
      fileId: config.drive.folderId,
      fields: 'id, name, mimeType, capabilities',
    });

    const folder = response.data;

    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`Target ID is not a folder: ${config.drive.folderId}`);
    }

    if (!folder.capabilities || !folder.capabilities.canAddChildren) {
      throw new Error('Service account does not have permission to add files to folder');
    }

    logger.info('Drive connection test successful', {
      folderId: folder.id,
      folderName: folder.name,
    });

    return true;
  } catch (error) {
    logger.logError('Drive connection test failed', error);
    throw error;
  }
}

module.exports = {
  initializeDriveClient,
  uploadFile,
  deleteFile,
  getFileMetadata,
  listFiles,
  getOrCreateDateFolder,
  generateUniqueFilename,
  testConnection,
};
