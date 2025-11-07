/**
 * Slack Request Verification Middleware
 * Validates Slack request signatures to prevent unauthorized access
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify Slack request signature
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Buffer} rawBody - Raw request body
 * @returns {boolean} - True if valid, false otherwise
 */
function verifySlackSignature(req, res, rawBody) {
  const slackSignature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!slackSignature || !timestamp) {
    logger.warn('Missing Slack signature or timestamp', {
      hasSignature: !!slackSignature,
      hasTimestamp: !!timestamp,
      ip: req.ip,
    });
    return false;
  }

  // Prevent replay attacks - reject requests older than 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(currentTime - parseInt(timestamp, 10));

  if (timeDiff > 300) {
    logger.warn('Slack request timestamp too old', {
      timestamp,
      currentTime,
      diff: timeDiff,
      ip: req.ip,
    });
    return false;
  }

  // Create signature base string
  const sigBasestring = `v0:${timestamp}:${rawBody}`;

  // Compute HMAC-SHA256
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', config.slack.signingSecret)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(slackSignature, 'utf8')
    );

    if (!isValid) {
      logger.warn('Invalid Slack signature', {
        ip: req.ip,
        path: req.path,
      });
    }

    return isValid;
  } catch (error) {
    logger.logError('Error comparing signatures', error, {
      ip: req.ip,
      path: req.path,
    });
    return false;
  }
}

/**
 * Express middleware for Slack request verification
 * Captures raw body and validates signature
 */
function slackVerificationMiddleware(req, res, next) {
  // Skip verification for health check endpoint
  if (req.path === '/health') {
    return next();
  }

  let rawBody = '';

  // Capture raw body
  req.on('data', chunk => {
    rawBody += chunk.toString('utf8');
  });

  req.on('end', () => {
    // Parse body
    try {
      req.body = JSON.parse(rawBody);
    } catch (error) {
      logger.warn('Failed to parse request body', {
        error: error.message,
        ip: req.ip,
      });
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Verify signature
    const isValid = verifySlackSignature(req, res, rawBody);

    if (!isValid) {
      logger.warn('Slack verification failed', {
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Signature is valid, proceed
    next();
  });
}

/**
 * Simpler middleware using Express's built-in body parser
 * This version requires express.json() middleware first
 */
function createSlackVerificationMiddleware() {
  return (req, res, next) => {
    // Skip verification for health check
    if (req.path === '/health') {
      return next();
    }

    const slackSignature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!slackSignature || !timestamp) {
      logger.warn('Missing Slack signature or timestamp', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized - Missing signature' });
    }

    // Prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - parseInt(timestamp, 10));

    if (timeDiff > 300) {
      logger.warn('Slack request timestamp too old', {
        timestamp,
        currentTime,
        diff: timeDiff,
        ip: req.ip,
      });
      return res.status(401).json({ error: 'Unauthorized - Timestamp too old' });
    }

    // Reconstruct raw body from parsed JSON
    const rawBody = JSON.stringify(req.body);
    const sigBasestring = `v0:${timestamp}:${rawBody}`;

    // Compute signature
    const mySignature = 'v0=' + crypto
      .createHmac('sha256', config.slack.signingSecret)
      .update(sigBasestring, 'utf8')
      .digest('hex');

    // Compare signatures
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(mySignature, 'utf8'),
        Buffer.from(slackSignature, 'utf8')
      );

      if (!isValid) {
        logger.warn('Invalid Slack signature', {
          ip: req.ip,
          path: req.path,
        });
        return res.status(401).json({ error: 'Unauthorized - Invalid signature' });
      }

      // Valid signature, proceed
      next();
    } catch (error) {
      logger.logError('Error verifying Slack signature', error, {
        ip: req.ip,
        path: req.path,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = {
  slackVerificationMiddleware,
  createSlackVerificationMiddleware,
  verifySlackSignature,
};
