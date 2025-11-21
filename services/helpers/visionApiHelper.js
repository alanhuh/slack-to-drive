/**
 * Google Cloud Vision API Helper
 *
 * Provides image analysis using Google Cloud Vision API
 * - Label Detection: Identifies objects, concepts in images
 * - Text Detection (OCR): Extracts text from images
 * - Image Properties: Analyzes colors and visual properties
 *
 * Supports both API Key and Service Account authentication
 */

const vision = require('@google-cloud/vision');
const axios = require('axios');
const logger = require('../../utils/logger');
const config = require('../../config');

class VisionApiHelper {
  constructor() {
    this.client = null;
    this.apiKey = null;
    this.useRestApi = false;
    this.initialized = false;
  }

  /**
   * Initialize Vision API client with credentials
   */
  initializeClient() {
    if (this.initialized) {
      return;
    }

    try {
      // Option 1: Use API Key (REST API)
      if (config.vision?.apiKey) {
        this.apiKey = config.vision.apiKey;
        this.useRestApi = true;
        logger.info('Vision API initialized with API Key (REST API mode)');
      }
      // Option 2: Use base64 encoded credentials from env
      else if (config.vision?.credentialsBase64) {
        const credentials = JSON.parse(
          Buffer.from(config.vision.credentialsBase64, 'base64').toString('utf-8')
        );
        this.client = new vision.ImageAnnotatorClient({ credentials });
        logger.info('Vision API client initialized with base64 credentials');
      }
      // Option 3: Use credentials file path
      else if (config.vision?.credentialsPath) {
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: config.vision.credentialsPath
        });
        logger.info('Vision API client initialized with credentials file');
      }
      // Option 4: Use application default credentials
      else {
        this.client = new vision.ImageAnnotatorClient();
        logger.info('Vision API client initialized with default credentials');
      }

      this.initialized = true;
    } catch (error) {
      logger.logError('Failed to initialize Vision API client', error);
      throw error;
    }
  }

  /**
   * Analyze image using Vision API
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @param {Object} options - Analysis options
   * @returns {Object} Analysis results
   */
  async analyzeImage(imageBuffer, options = {}) {
    if (!this.initialized) {
      this.initializeClient();
    }

    const startTime = Date.now();

    try {
      // Request features
      const features = [
        { type: 'LABEL_DETECTION', maxResults: 10 },
        { type: 'TEXT_DETECTION' },
        { type: 'IMAGE_PROPERTIES' },
        { type: 'FACE_DETECTION', maxResults: 20 }  // For solo vs group detection
      ];

      if (options.includeObjects) {
        features.push({ type: 'OBJECT_LOCALIZATION', maxResults: 10 });
      }

      let result;

      // Use REST API with API Key
      if (this.useRestApi) {
        result = await this.analyzeImageWithRestApi(imageBuffer, features);
      }
      // Use SDK with Service Account
      else {
        const image = { content: imageBuffer };
        const [sdkResult] = await this.client.annotateImage({
          image: image,
          features: features
        });
        result = sdkResult;
      }

      const processingTime = Date.now() - startTime;

      // Parse and return results
      const analysis = {
        labels: this.parseLabels(result.labelAnnotations || []),
        text: this.parseText(result.textAnnotations || []),
        colors: this.parseColors(result.imagePropertiesAnnotation),
        objects: options.includeObjects ? this.parseObjects(result.localizedObjectAnnotations || []) : [],
        faces: this.parseFaces(result.faceAnnotations || []),
        processingTime: processingTime
      };

      logger.info('Image analyzed with Vision API', {
        labelCount: analysis.labels.length,
        hasText: analysis.text.full.length > 0,
        faceCount: analysis.faces.count,
        processingTime,
        method: this.useRestApi ? 'REST API' : 'SDK'
      });

      return analysis;

    } catch (error) {
      logger.logError('Vision API analysis failed', error);
      throw error;
    }
  }

  /**
   * Analyze image using REST API with API Key
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @param {Array} features - Vision API features to request
   * @returns {Object} Vision API response
   */
  async analyzeImageWithRestApi(imageBuffer, features) {
    try {
      const base64Image = imageBuffer.toString('base64');

      const requestBody = {
        requests: [
          {
            image: {
              content: base64Image
            },
            features: features
          }
        ]
      };

      const response = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 seconds
        }
      );

      if (response.data.responses && response.data.responses[0]) {
        const result = response.data.responses[0];

        // Check for errors in response
        if (result.error) {
          throw new Error(`Vision API error: ${result.error.message}`);
        }

        return result;
      } else {
        throw new Error('Invalid response from Vision API');
      }

    } catch (error) {
      if (error.response) {
        logger.logError('Vision API REST request failed', error, {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }
      throw error;
    }
  }

  /**
   * Parse label annotations
   */
  parseLabels(labelAnnotations) {
    return labelAnnotations.map(label => ({
      description: label.description,
      score: label.score,
      confidence: Math.round(label.score * 100)
    }))
    .sort((a, b) => b.score - a.score);
  }

  /**
   * Parse text annotations (OCR)
   */
  parseText(textAnnotations) {
    if (textAnnotations.length === 0) {
      return {
        full: '',
        words: [],
        hasText: false
      };
    }

    // First annotation is full text
    const fullText = textAnnotations[0]?.description || '';

    // Rest are individual words
    const words = textAnnotations.slice(1).map(text => ({
      text: text.description,
      confidence: text.confidence || 0
    }));

    return {
      full: fullText,
      words: words,
      hasText: fullText.length > 0
    };
  }

  /**
   * Parse dominant colors
   */
  parseColors(imageProperties) {
    if (!imageProperties || !imageProperties.dominantColors) {
      return [];
    }

    return imageProperties.dominantColors.colors
      .slice(0, 5)
      .map(colorInfo => ({
        r: colorInfo.color.red || 0,
        g: colorInfo.color.green || 0,
        b: colorInfo.color.blue || 0,
        score: colorInfo.score,
        pixelFraction: colorInfo.pixelFraction
      }));
  }

  /**
   * Parse object localization
   */
  parseObjects(objectAnnotations) {
    return objectAnnotations.map(obj => ({
      name: obj.name,
      score: obj.score,
      confidence: Math.round(obj.score * 100)
    }))
    .sort((a, b) => b.score - a.score);
  }

  /**
   * Parse face detection annotations
   */
  parseFaces(faceAnnotations) {
    if (!faceAnnotations || faceAnnotations.length === 0) {
      return {
        count: 0,
        faces: []
      };
    }

    return {
      count: faceAnnotations.length,
      faces: faceAnnotations.map(face => ({
        confidence: face.detectionConfidence,
        joy: face.joyLikelihood,
        anger: face.angerLikelihood
      }))
    };
  }

  /**
   * Test Vision API connection
   */
  async testConnection() {
    if (!this.initialized) {
      this.initializeClient();
    }

    try {
      // Create a minimal 1x1 pixel image for testing
      const testImage = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      if (this.useRestApi) {
        // Test with REST API
        await this.analyzeImageWithRestApi(testImage, [{ type: 'LABEL_DETECTION', maxResults: 1 }]);
      } else {
        // Test with SDK
        await this.client.labelDetection(testImage);
      }

      logger.info('Vision API connection test successful', {
        method: this.useRestApi ? 'REST API' : 'SDK'
      });
      return true;
    } catch (error) {
      logger.logError('Vision API connection test failed', error);
      return false;
    }
  }

  /**
   * Get usage quota info (requires billing API enabled)
   */
  async getQuotaInfo() {
    // Note: This requires additional setup
    // For now, return placeholder
    return {
      monthlyLimit: 1000,
      message: 'Check GCP Console for accurate quota info'
    };
  }
}

// Export singleton instance
module.exports = new VisionApiHelper();
