/**
 * Filename Generator
 *
 * Generates meaningful filenames based on:
 * - Slack message context
 * - Vision API labels and OCR text
 * - Original filename
 * - Category
 */

const logger = require('../../utils/logger');
const validator = require('../../utils/validator');

class FilenameGenerator {
  /**
   * Generate filename from context and vision analysis
   * @param {Object} params - Generation parameters
   * @returns {String} Generated filename
   */
  generateFilename(params) {
    const {
      originalFilename,
      category,
      slackContext,
      visionAnalysis,
      mimeType
    } = params;

    // Extract file extension
    const extension = this.getExtension(originalFilename, mimeType);

    // Try different strategies in order of priority
    let basename = null;

    // Strategy 1: Extract from Slack context (highest priority)
    basename = this.extractFromSlackContext(slackContext);

    // Strategy 2: Use Vision OCR text
    if (!basename && visionAnalysis.text.hasText) {
      basename = this.extractFromOcrText(visionAnalysis.text);
    }

    // Strategy 3: Use Vision labels
    if (!basename && visionAnalysis.labels.length > 0) {
      basename = this.extractFromVisionLabels(visionAnalysis.labels, category);
    }

    // Strategy 4: Use original filename (sanitized)
    if (!basename) {
      basename = this.sanitizeOriginalFilename(originalFilename);
    }

    // Strategy 5: Fallback to generic name
    if (!basename) {
      basename = this.generateGenericName(category);
    }

    // Combine and sanitize
    const filename = `${basename}.${extension}`;
    const sanitized = validator.sanitizeFilename(filename);

    logger.info('Filename generated', {
      original: originalFilename,
      generated: sanitized,
      strategy: basename ? 'context' : 'generic'
    });

    return sanitized;
  }

  /**
   * Extract meaningful name from Slack context
   */
  extractFromSlackContext(slackContext) {
    if (!slackContext || !slackContext.messages || slackContext.messages.length === 0) {
      return null;
    }

    // Get the first non-empty message
    const relevantMessage = slackContext.messages.find(m => m.text && m.text.trim().length > 0);

    if (!relevantMessage) {
      return null;
    }

    const text = relevantMessage.text;

    // Extract meaningful phrases
    // Remove URLs, mentions, special characters
    let cleaned = text
      .replace(/<@[A-Z0-9]+>/g, '') // Remove user mentions
      .replace(/<#[A-Z0-9]+\|[^>]+>/g, '') // Remove channel mentions
      .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
      .replace(/[<>]/g, '') // Remove brackets
      .trim();

    // Take first meaningful segment (up to 50 chars)
    cleaned = cleaned.slice(0, 50).trim();

    if (cleaned.length < 3) {
      return null;
    }

    // Convert to filename-safe format
    let filename = cleaned
      .replace(/\s+/g, '_') // Spaces to underscores
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '') // Remove special chars
      .replace(/_+/g, '_') // Multiple underscores to single
      .replace(/^_|_$/g, ''); // Trim underscores

    return filename || null;
  }

  /**
   * Extract name from OCR text
   */
  extractFromOcrText(textAnalysis) {
    if (!textAnalysis.hasText || textAnalysis.full.length < 3) {
      return null;
    }

    // Take first line or first 30 characters
    const text = textAnalysis.full.split('\n')[0].slice(0, 30).trim();

    if (text.length < 3) {
      return null;
    }

    // Convert to filename-safe format
    let filename = text
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return filename || null;
  }

  /**
   * Extract name from Vision labels
   */
  extractFromVisionLabels(labels, category) {
    if (labels.length === 0) {
      return null;
    }

    // Take top 2-3 labels with high confidence
    const topLabels = labels
      .filter(l => l.score > 0.7)
      .slice(0, 3)
      .map(l => l.description);

    if (topLabels.length === 0) {
      return null;
    }

    // Combine labels
    let filename = topLabels
      .join('_')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '')
      .toLowerCase();

    return filename || null;
  }

  /**
   * Sanitize original filename (remove extension and dates)
   */
  sanitizeOriginalFilename(originalFilename) {
    if (!originalFilename) {
      return null;
    }

    // Remove extension
    let name = originalFilename.replace(/\.[^/.]+$/, '');

    // Remove common patterns
    name = name
      .replace(/screenshot/gi, '')
      .replace(/capture/gi, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, '') // Remove dates
      .replace(/\d{8}/g, '') // Remove date stamps
      .replace(/[_-]+/g, '_') // Normalize separators
      .replace(/^_|_$/g, '') // Trim separators
      .trim();

    if (name.length < 3) {
      return null;
    }

    return name;
  }

  /**
   * Generate generic name based on category
   */
  generateGenericName(category) {
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits

    const prefixes = {
      '캐릭터_일러스트': 'character',
      '배경_일러스트': 'background',
      'UI_디자인': 'ui_design',
      '스크린샷': 'screenshot',
      '참고자료': 'reference',
      '기타': 'image'
    };

    const prefix = prefixes[category] || 'image';
    return `${prefix}_${timestamp}`;
  }

  /**
   * Get file extension from filename or MIME type
   */
  getExtension(filename, mimeType) {
    // Try to get extension from filename
    const match = filename?.match(/\.([^.]+)$/);
    if (match) {
      return match[1].toLowerCase();
    }

    // Fallback to MIME type
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp'
    };

    return mimeMap[mimeType] || 'png';
  }

  /**
   * Add uniqueness suffix if needed
   */
  addUniqueSuffix(filename, existingFilenames = []) {
    if (!existingFilenames.includes(filename)) {
      return filename;
    }

    const [basename, extension] = this.splitFilename(filename);
    let counter = 1;

    while (existingFilenames.includes(`${basename}_${counter}.${extension}`)) {
      counter++;
    }

    return `${basename}_${counter}.${extension}`;
  }

  /**
   * Split filename into basename and extension
   */
  splitFilename(filename) {
    const match = filename.match(/^(.+)\.([^.]+)$/);
    if (match) {
      return [match[1], match[2]];
    }
    return [filename, 'png'];
  }
}

// Export singleton instance
module.exports = new FilenameGenerator();
