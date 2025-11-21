/**
 * Classification Rules
 *
 * Defines rules for classifying images into categories based on:
 * - Slack message keywords
 * - Google Vision API labels
 * - OCR text presence
 * - User history
 *
 * This file uses a Skills-based architecture:
 * - Base rules are defined in BASE_RULES (static)
 * - Learned rules are loaded from data/learned-rules.json (dynamic)
 * - Rules are merged at runtime, no code modification needed
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

/**
 * Load learned rules from JSON file
 */
function loadLearnedRules() {
  const learnedRulesPath = path.join(__dirname, '../../data/learned-rules.json');

  if (fs.existsSync(learnedRulesPath)) {
    try {
      const content = fs.readFileSync(learnedRulesPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn('Failed to load learned rules', { error: error.message });
      return {};
    }
  }

  return {};
}

/**
 * Merge base rules with learned rules
 */
function mergeRules(baseRules, learnedRules) {
  const merged = {};

  for (const category in baseRules) {
    const base = baseRules[category];
    const learned = learnedRules[category];

    // If no learned rules or no changes, use base rules
    if (!learned || learned.noChanges) {
      merged[category] = base;
      continue;
    }

    // Merge base rules with learned rules
    merged[category] = {
      ...base,
      // Override priority if learned
      priority: learned.recommendedPriority || base.priority,
      // Override hasText if learned
      hasText: learned.hasText !== undefined ? learned.hasText : base.hasText,
      // Merge vision labels (learned labels first for priority)
      visionLabels: [
        ...(learned.requiredLabels || []),
        ...(learned.recommendedLabels || []),
        ...base.visionLabels
      ].filter((label, index, self) => self.indexOf(label) === index), // Remove duplicates
      // Merge anti-labels
      antiLabels: [
        ...(learned.antiLabels || []),
        ...(base.antiLabels || [])
      ].filter((label, index, self) => self.indexOf(label) === index) // Remove duplicates
    };
  }

  return merged;
}

// Base category definitions (static, never modified)
const BASE_RULES = {
  '캐릭터 일러스트 (단독)': {
    keywords: [
      '캐릭터', 'character', '단독', 'solo', 'single', '일러스트', 'illustration',
      '그림', 'drawing', 'portrait', '인물', '캐릭', 'char', 'persona',
      '1인', 'one', 'alone'
    ],
    visionLabels: [
      'Graphics',
      'Animation',
      'Fictional character',
      'Graphic design',
      'Animated cartoon',
      'Fiction',
      'Anime',
      'Hero',
      'Costume',
      'Cartoon',
      'person',
      'character',
      'anime',
      'cartoon',
      'drawing',
      'art',
      'illustration',
      'sketch',
      'portrait',
      'face',
      'manga',
      'comic',
      'human',
      'figure',
      'character design'
    ],
    antiLabels: [
      'crowd',
      'group',
      'people',
      'team',
      'landscape',
      'scenery'
    ],
    hasText: false, // 텍스트가 적을수록 가산점
    priority: 0.85,
    requiresSinglePerson: true // Special rule: should detect only 1 person
  },

  '일러스트 (단체)': {
    keywords: [
      '일러스트', 'illustration', '단체', 'group', 'team', 'multiple', 'many',
      '배경', 'background', '풍경', 'landscape', 'scenery', 'environment',
      '복수', 'several', '여러', 'bg', '씬', 'scene'
    ],
    visionLabels: [
      'Animation',
      'Fiction',
      'Fictional character',
      'Animated cartoon',
      'Anime',
      'Cartoon',
      'Hero',
      'CG artwork',
      'Graphics',
      'PC game',
      'people',
      'group',
      'crowd',
      'team',
      'illustration',
      'art',
      'drawing',
      'landscape',
      'sky',
      'mountain',
      'nature',
      'scenery',
      'environment',
      'outdoor',
      'building',
      'architecture',
      'city',
      'forest',
      'ocean',
      'background',
      'scene',
      'anime',
      'cartoon'
    ],
    antiLabels: [
      'High-rise building',
      'Cityscape',
      'Skyscraper',
      'Animation',
      'Tower'
    ],
    hasText: false,
    priority: 0.8,
    requiresMultipleElements: true // Multiple people or complex background
  },

  'UI / 화면': {
    keywords: [
      'ui', 'ux', '디자인', 'design', '화면', 'screen', '인터페이스', 'interface',
      '목업', 'mockup', '프로토타입', 'prototype', '앱', 'app', '웹', 'web',
      '버튼', 'button', '레이아웃', 'layout', '메뉴', 'menu'
    ],
    visionLabels: [
      'Animation',
      'Animated cartoon',
      'Video Game Software',
      'Anime',
      'Fictional character',
      'Screenshot',
      'Graphic design',
      'High-rise building',
      'Game',
      'PC game',
      'user interface',
      'mobile app',
      'website',
      'application',
      'software',
      'screen',
      'display',
      'button',
      'menu',
      'icon',
      'logo',
      'design',
      'mockup',
      'prototype',
      'dashboard',
      'webpage',
      'ui design'
    ],
    antiLabels: [
      'Diagram',
      'Graphic design',
      'Screenshot',
      'Plan',
      'Animation',
      'Graphics',
      'Video Game Software'
    ],
    hasText: true, // UI는 보통 텍스트 많음
    priority: 0.82
  },

  '게임 스크린샷': {
    keywords: [
      '게임', 'game', 'gaming', '게임플레이', 'gameplay', '플레이', 'play',
      '스크린샷', 'screenshot', '캡처', 'capture', '화면캡처', 'screencap',
      'ss', '캡쳐', 'cap', '인게임', 'ingame'
    ],
    visionLabels: [
      'Animation',
      'Video Game Software',
      'Fictional character',
      'PC game',
      'Screenshot',
      'Graphics',
      'Graphic design',
      'game',
      'video game',
      'gaming',
      'gameplay',
      'screenshot',
      'game screen',
      'computer monitor',
      'display',
      'screen',
      'window',
      'desktop',
      'game ui',
      'hud',
      'health bar',
      'game interface'
    ],
    hasText: false, // 게임 UI 텍스트
    priority: 0.86
  },

  '기타': {
    keywords: [
      '기타', 'other', 'misc', 'miscellaneous', '미분류', 'uncategorized',
      '잡다', 'various', '모호', 'unclear'
    ],
    visionLabels: [],
    hasText: false,
    priority: 0.79 // 최후의 선택
  }
};

// Merge base rules with learned rules at runtime
const CATEGORY_RULES = mergeRules(BASE_RULES, loadLearnedRules());

// Log if learned rules were applied
const learnedRules = loadLearnedRules();
if (Object.keys(learnedRules).length > 0) {
  const appliedCount = Object.values(learnedRules).filter(r => !r.noChanges).length;
  logger.info('Learned classification rules loaded', {
    total: Object.keys(learnedRules).length,
    applied: appliedCount,
    skipped: Object.keys(learnedRules).length - appliedCount
  });
}

class ClassificationRules {
  /**
   * Classify image based on Vision API results and Slack context
   * @param {Object} visionAnalysis - Vision API analysis results
   * @param {Object} slackContext - Slack message context
   * @param {Array} existingCategories - List of existing categories in Drive
   * @returns {Object} Classification result
   */
  classifyImage(visionAnalysis, slackContext, existingCategories = []) {
    const scores = {};

    // Initialize scores for all categories
    for (const category of Object.keys(CATEGORY_RULES)) {
      scores[category] = 0;
    }

    // 1. Analyze Slack message keywords (40% weight)
    const keywordScores = this.analyzeKeywords(slackContext);
    for (const [category, score] of Object.entries(keywordScores)) {
      scores[category] += score * 0.4;
    }

    // 2. Analyze Vision API labels (40% weight)
    const labelScores = this.analyzeVisionLabels(visionAnalysis.labels);
    for (const [category, score] of Object.entries(labelScores)) {
      scores[category] += score * 0.4;
    }

    // 3. Analyze text presence (30% weight - increased from 20% for better group/solo distinction)
    const textScores = this.analyzeTextPresence(visionAnalysis.text);
    for (const [category, score] of Object.entries(textScores)) {
      scores[category] += score * 0.3;
    }

    // 4. Analyze face counts for solo vs group detection (HIGH PRIORITY)
    if (visionAnalysis.faces && visionAnalysis.faces.count !== undefined) {
      const faceCount = visionAnalysis.faces.count;

      if (faceCount === 1) {
        // Single face detected - STRONG indicator of solo character
        scores['캐릭터 일러스트 (단독)'] = Math.min(scores['캐릭터 일러스트 (단독)'] + 0.25, 1.0);
        logger.info('Single face detected - boosting solo score', { faceCount: 1 });
      } else if (faceCount >= 2) {
        // Multiple faces detected - STRONG indicator of group
        scores['일러스트 (단체)'] = Math.min(scores['일러스트 (단체)'] + 0.30, 1.0);
        // Penalize solo category to prevent misclassification
        scores['캐릭터 일러스트 (단독)'] = Math.max(scores['캐릭터 일러스트 (단독)'] - 0.20, 0);
        logger.info('Multiple faces detected - boosting group score', { faceCount });
      } else if (faceCount === 0) {
        // No faces - likely UI, screenshot, or background
        scores['UI / 화면'] = Math.min(scores['UI / 화면'] + 0.10, 1.0);
        scores['게임 스크린샷'] = Math.min(scores['게임 스크린샷'] + 0.10, 1.0);
        scores['기타'] = Math.min(scores['기타'] + 0.05, 1.0);
        logger.info('No faces detected - boosting UI/screenshot scores', { faceCount: 0 });
      }
    }

    // 5. Text length analysis for solo vs group distinction (FREE - NO API COST)
    if (visionAnalysis.text && visionAnalysis.text.hasText) {
      const textLength = visionAnalysis.text.full.length;

      // Solo characters typically have SHORT text (logos, branding)
      // Learned threshold: 84 chars (median for solo)
      if (textLength < 120) {
        scores['캐릭터 일러스트 (단독)'] = Math.min(scores['캐릭터 일러스트 (단독)'] + 0.15, 1.0);
        logger.info('Short text detected - boosting solo score', { textLength });
      }

      // Group illustrations have LONG text (scene elements, multiple labels)
      // Learned threshold: 204 chars (median for group)
      else if (textLength > 180) {
        scores['일러스트 (단체)'] = Math.min(scores['일러스트 (단체)'] + 0.20, 1.0);
        scores['캐릭터 일러스트 (단독)'] = Math.max(scores['캐릭터 일러스트 (단독)'] - 0.15, 0);
        logger.info('Long text detected - boosting group score', { textLength });
      }
    }

    // 6. Logo/branding text detection (FREE - NO API COST)
    if (visionAnalysis.text && visionAnalysis.text.hasText) {
      const text = visionAnalysis.text.full.toUpperCase();
      const textLength = visionAnalysis.text.full.length;

      // Check for brand logos: "DYNAMITE BLUE" appears in solo character illustrations
      const hasLogos = text.includes('DYNAMITE') || text.includes('BLUE') ||
                       text.includes('ERHA') || text.includes('ERHAV') || text.includes('ERHAVEN');

      if (hasLogos && textLength < 150) {
        // Logo present + short text = likely solo character illustration
        scores['캐릭터 일러스트 (단독)'] = Math.min(scores['캐릭터 일러스트 (단독)'] + 0.10, 1.0);
        logger.info('Brand logo detected in short text - boosting solo', {
          hasLogos,
          textLength,
          logoMatch: text.match(/(DYNAMITE|BLUE|ERHA)/g)?.[0]
        });
      }
    }

    // 7. Color diversity analysis (FREE - already collected by Vision API)
    if (visionAnalysis.colors && visionAnalysis.colors.length > 0) {
      const topColor = visionAnalysis.colors[0];
      const topColorDominance = topColor.pixelFraction;

      // Solo characters often have simpler, more uniform backgrounds
      // High color dominance = one color takes up most of the image
      if (topColorDominance > 0.4) {
        scores['캐릭터 일러스트 (단독)'] = Math.min(scores['캐릭터 일러스트 (단독)'] + 0.05, 1.0);
        logger.debug('High color dominance - slight solo boost', {
          dominance: topColorDominance.toFixed(2),
          rgb: `rgb(${topColor.r}, ${topColor.g}, ${topColor.b})`
        });
      }

      // Group illustrations tend to have more color diversity (lower dominance)
      else if (topColorDominance < 0.25 && visionAnalysis.colors.length >= 3) {
        scores['일러스트 (단체)'] = Math.min(scores['일러스트 (단체)'] + 0.05, 1.0);
        logger.debug('Low color dominance with diversity - slight group boost', {
          dominance: topColorDominance.toFixed(2),
          colorCount: visionAnalysis.colors.length
        });
      }
    }

    // 8. Apply priority adjustments
    for (const [category, score] of Object.entries(scores)) {
      const priority = CATEGORY_RULES[category].priority;
      scores[category] = score * priority;
    }

    // Sort categories by score
    const sortedCategories = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([category, score]) => ({
        name: category,
        confidence: Math.min(score, 1.0),
        score: score
      }));

    const topCategory = sortedCategories[0];
    const method = this.determineMethod(keywordScores, labelScores, textScores, topCategory.name);

    logger.info('Classification completed', {
      category: topCategory.name,
      confidence: topCategory.confidence.toFixed(2),
      method: method,
      topScores: sortedCategories.slice(0, 3).map(c => `${c.name}:${c.confidence.toFixed(2)}`)
    });

    return {
      category: topCategory.name,
      confidence: topCategory.confidence,
      method: method,
      alternatives: sortedCategories.slice(1, 3),
      scores: scores // for debugging
    };
  }

  /**
   * Analyze Slack message keywords
   */
  analyzeKeywords(slackContext) {
    const scores = {};
    const contextText = this.extractContextText(slackContext).toLowerCase();

    if (!contextText) {
      // No context, return 0 scores
      for (const category of Object.keys(CATEGORY_RULES)) {
        scores[category] = 0;
      }
      return scores;
    }

    for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
      let matchCount = 0;

      for (const keyword of rules.keywords) {
        if (contextText.includes(keyword.toLowerCase())) {
          matchCount++;
        }
      }

      // Normalize by number of keywords (max 1.0)
      scores[category] = Math.min(matchCount / 2, 1.0);
    }

    return scores;
  }

  /**
   * Analyze Vision API labels
   */
  analyzeVisionLabels(labels) {
    const scores = {};

    if (!labels || labels.length === 0) {
      for (const category of Object.keys(CATEGORY_RULES)) {
        scores[category] = 0;
      }
      return scores;
    }

    const labelTexts = labels.map(l => l.description.toLowerCase());

    for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
      let matchScore = 0;

      // Positive matching: boost score for matching vision labels
      for (const visionLabel of rules.visionLabels) {
        const matchedLabel = labelTexts.find(lt =>
          lt.includes(visionLabel.toLowerCase()) || visionLabel.toLowerCase().includes(lt)
        );

        if (matchedLabel) {
          // Find confidence score of matched label
          const labelObj = labels.find(l => l.description.toLowerCase() === matchedLabel);
          if (labelObj) {
            matchScore = Math.max(matchScore, labelObj.score);
          }
        }
      }

      // Negative matching: penalize score for matching anti-labels
      if (rules.antiLabels && rules.antiLabels.length > 0) {
        for (const antiLabel of rules.antiLabels) {
          const matchedAntiLabel = labelTexts.find(lt =>
            lt.includes(antiLabel.toLowerCase()) || antiLabel.toLowerCase().includes(lt)
          );

          if (matchedAntiLabel) {
            // Find confidence score of matched anti-label
            const antiLabelObj = labels.find(l => l.description.toLowerCase() === matchedAntiLabel);
            if (antiLabelObj) {
              // Penalize by 15% of the anti-label's confidence (reduced from 30% to avoid over-penalization)
              matchScore -= antiLabelObj.score * 0.15;
            }
          }
        }
      }

      // Ensure score doesn't go negative
      scores[category] = Math.max(0, matchScore);
    }

    return scores;
  }

  /**
   * Analyze text presence (OCR results)
   */
  analyzeTextPresence(textAnalysis) {
    const scores = {};
    const hasText = textAnalysis.hasText;
    const textLength = textAnalysis.full.length;

    for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
      if (rules.hasText === null) {
        // Text presence doesn't matter
        scores[category] = 0.5;
      } else if (rules.hasText === true && hasText && textLength > 10) {
        // Category expects text and image has text
        scores[category] = Math.min(textLength / 100, 1.0);
      } else if (rules.hasText === false && (!hasText || textLength < 10)) {
        // Category expects no text and image has no text
        scores[category] = 1.0;
      } else {
        // Mismatch
        scores[category] = 0.2;
      }
    }

    return scores;
  }

  /**
   * Extract text from Slack context
   */
  extractContextText(slackContext) {
    if (!slackContext || !slackContext.messages) {
      return '';
    }

    return slackContext.messages
      .map(m => m.text || '')
      .join(' ');
  }

  /**
   * Count person/character objects from Vision API object detection
   * @param {Array} objects - Vision API detected objects
   * @returns {number} Number of person objects detected
   */
  countPersonObjects(objects) {
    if (!objects || objects.length === 0) {
      return 0;
    }

    // Count objects that are likely to be people/characters
    const personKeywords = ['person', 'human', 'people', 'man', 'woman', 'character'];
    let personCount = 0;

    for (const obj of objects) {
      const objName = obj.name.toLowerCase();

      // Check if object name contains person-related keywords
      if (personKeywords.some(keyword => objName.includes(keyword))) {
        personCount++;
      }
    }

    return personCount;
  }

  /**
   * Determine classification method
   */
  determineMethod(keywordScores, labelScores, textScores, topCategory) {
    const keywordScore = keywordScores[topCategory] || 0;
    const labelScore = labelScores[topCategory] || 0;

    if (keywordScore > 0.5 && labelScore > 0.5) {
      return 'hybrid';
    } else if (keywordScore > 0.5) {
      return 'keyword_match';
    } else if (labelScore > 0.5) {
      return 'vision_api';
    } else {
      return 'low_confidence';
    }
  }

  /**
   * Get category rules for a specific category
   */
  getCategoryRules(category) {
    return CATEGORY_RULES[category] || null;
  }

  /**
   * Get all available categories
   */
  getAllCategories() {
    return Object.keys(CATEGORY_RULES);
  }
}

// Export singleton instance
module.exports = new ClassificationRules();
