// ============================================
// HYBRID FIELD CLASSIFIER v3.0 - ACCURACY OPTIMIZED
// Combines Zero-Shot Classification with Semantic Similarity
// for maximum accuracy on job application forms
// 
// Models used (accuracy-first approach):
// - Zero-shot: MoritzLaurer/deberta-v3-large-zeroshot-v2.0 (435M params, SOTA)
// - Embeddings: Xenova/bge-m3 (568M params, highest accuracy in JS)
// ============================================

import { pipeline, env, cos_sim } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure model caching
const CACHE_DIR = path.join(__dirname, '..', 'models');
env.cacheDir = CACHE_DIR;
env.allowLocalModels = true;

/**
 * HybridFieldClassifier
 * 
 * Uses a two-stage approach for MAXIMUM ACCURACY:
 * 1. Zero-shot NLI classification (DeBERTa-v3-large) for high-confidence matches
 * 2. Semantic similarity (BGE-M3) fallback for ambiguous fields
 * 
 * Note: This configuration prioritizes accuracy over speed.
 * Load time: ~10-15 seconds
 * Inference: ~100-200ms per field
 * Memory: ~3-4 GB
 */
class HybridFieldClassifier {
  constructor(options = {}) {
    this.zeroShotClassifier = null;
    this.embeddingModel = null;
    this.featureExtractor = null;
    this.isLoaded = false;
    
    // Configurable thresholds
    this.zeroShotConfidenceThreshold = options.confidenceThreshold || 0.45;
    this.similarityThreshold = options.similarityThreshold || 0.6;
    
    // ============================================
    // MODEL CONFIGURATION - ACCURACY OPTIMIZED
    // ============================================
    
    // Zero-shot model: MoritzLaurer's DeBERTa-v3-large (HIGHEST ACCURACY)
    // - 435M parameters
    // - Trained on 33 datasets with 389 classes
    // - 9.4% better than v1 models
    // - Best zero-shot classification accuracy available
    this.zeroShotModelName = options.zeroShotModel || 'MoritzLaurer/deberta-v3-large-zeroshot-v2.0';
    
    // Embedding model: BGE-M3 (HIGHEST ACCURACY in JavaScript)
    // - 568M parameters
    // - MTEB score ~65 (vs ~56 for MiniLM)
    // - 1024 embedding dimensions (vs 384 for MiniLM)
    // - Uses CLS pooling (not mean pooling)
    this.embeddingModelName = options.embeddingModel || 'Xenova/bge-m3';
    
    // Pre-computed embeddings cache
    this.fieldEmbeddings = new Map();
    this.predictionCache = new Map();
    
    // Hypothesis template - critical for NLI performance
    this.hypothesisTemplate = 'This form field asks for {}';
  }

  // ============================================
  // CANDIDATE LABELS - Optimized for NLI
  // ============================================
  
  static LABELS = {
    // Personal Information
    PERSONAL: [
      "the applicant's first name",
      "the applicant's middle name",
      "the applicant's last name or family name",
      "an email address",
      "a phone number",
      "a street address or mailing address",
      "the name of a city",
      "a state or province or region",
      "a postal code or zip code",
      "a country name",
    ],
    
    // Work Authorization - Most critical for accuracy
    WORK_AUTH: [
      "whether the applicant can legally work in this country without sponsorship",
      "whether the applicant will need visa sponsorship now or in the future",
      "whether the applicant is a US citizen or permanent resident for export control purposes",
      "whether the applicant previously worked at this company",
    ],
    
    // Education
    EDUCATION: [
      "the name of a school or university",
      "the type of academic degree like Bachelor's or Master's",
      "the applicant's major or field of study",
      "a graduation date or year",
    ],
    
    // EEO / Demographics
    EEO: [
      "the applicant's gender identity",
      "the applicant's race or ethnicity",
      "whether the applicant is a military veteran",
      "whether the applicant has a disability",
    ],
    
    // Employment
    EMPLOYMENT: [
      "how the applicant heard about this job opening",
      "the name of an employee who referred the applicant",
      "the applicant's LinkedIn profile URL",
      "the applicant's website or portfolio URL",
    ],
    
    // Other
    OTHER: [
      "agreement to terms and conditions",
      "a date or signature date",
      "a resume or CV file upload",
      "professional skills or competencies",
    ],
  };

  // Flatten all labels for zero-shot classification
  static get ALL_LABELS() {
    return Object.values(HybridFieldClassifier.LABELS).flat();
  }

  // ============================================
  // SEMANTIC SIMILARITY VARIATIONS
  // For fields that might be phrased unusually
  // BGE-M3 excels at matching these variations
  // ============================================
  
  static FIELD_VARIATIONS = {
    'work_authorization': [
      'authorized to work',
      'legally authorized to work',
      'legal right to work',
      'eligible to work',
      'work permit',
      'can you work legally',
      'do you have the right to work',
      'employment authorization',
      'lawfully authorized',
      'permitted to work',
      'authorization to work in the united states',
    ],
    'visa_sponsorship': [
      'require sponsorship',
      'need sponsorship',
      'visa sponsorship',
      'immigration sponsorship',
      'will you need sponsorship',
      'h-1b sponsorship',
      'work visa sponsorship',
      'require visa',
      'sponsor for visa',
      'future sponsorship',
      'sponsorship to work',
      'immigration status sponsorship',
    ],
    'previous_employee': [
      'previously worked',
      'former employee',
      'worked here before',
      'past employee',
      'previously employed',
      'have you ever worked',
      'prior employment',
      'worked at this company',
      'returning employee',
      'rehire',
    ],
    'first_name': [
      'first name',
      'given name',
      'forename',
      'your first name',
      'legal first name',
      'nombre',
      'preferred first name',
    ],
    'last_name': [
      'last name',
      'family name',
      'surname',
      'your last name',
      'legal last name',
      'apellido',
      'preferred last name',
    ],
    'referral_source': [
      'how did you hear',
      'where did you hear',
      'how did you find',
      'source',
      'referral source',
      'job source',
      'where did you learn',
      'how did you learn about',
      'recruitment source',
    ],
    'gender': [
      'gender',
      'sex',
      'gender identity',
      'what is your gender',
      'select your gender',
    ],
    'ethnicity': [
      'ethnicity',
      'race',
      'ethnic background',
      'racial background',
      'what is your ethnicity',
      'what is your race',
      'racial identity',
    ],
    'veteran_status': [
      'veteran',
      'military',
      'armed forces',
      'served in military',
      'protected veteran',
      'military service',
      'veteran status',
      'military veteran',
    ],
    'disability_status': [
      'disability',
      'disabled',
      'handicap',
      'impairment',
      'do you have a disability',
      'disability status',
      'self identify disability',
    ],
    'email': [
      'email',
      'email address',
      'e-mail',
      'electronic mail',
      'your email',
    ],
    'phone': [
      'phone',
      'phone number',
      'telephone',
      'mobile',
      'cell phone',
      'contact number',
    ],
    'linkedin': [
      'linkedin',
      'linkedin profile',
      'linkedin url',
      'linkedin link',
    ],
  };

  // ============================================
  // LABEL TO PROFILE MAPPING
  // Maps classification results to profile data
  // ============================================
  
  static LABEL_TO_PROFILE = {
    // Personal
    "the applicant's first name": {
      key: 'firstName',
      getValue: (p) => p.personal?.firstName,
      fieldTypes: ['text'],
    },
    "the applicant's middle name": {
      key: 'middleName',
      getValue: (p) => p.personal?.middleName || '',
      fieldTypes: ['text'],
    },
    "the applicant's last name or family name": {
      key: 'lastName',
      getValue: (p) => p.personal?.lastName,
      fieldTypes: ['text'],
    },
    "an email address": {
      key: 'email',
      getValue: (p) => p.personal?.email,
      fieldTypes: ['text'],
    },
    "a phone number": {
      key: 'phone',
      getValue: (p) => p.personal?.phone?.replace(/[\(\)\-\s]/g, ''),
      fieldTypes: ['text'],
    },
    "a street address or mailing address": {
      key: 'address',
      getValue: (p) => p.address?.line1,
      fieldTypes: ['text'],
    },
    "the name of a city": {
      key: 'city',
      getValue: (p) => p.address?.city,
      fieldTypes: ['text'],
    },
    "a state or province or region": {
      key: 'state',
      getValue: (p) => p.address?.state,
      fieldTypes: ['text', 'dropdown'],
    },
    "a postal code or zip code": {
      key: 'zipCode',
      getValue: (p) => p.address?.zipCode,
      fieldTypes: ['text'],
    },
    "a country name": {
      key: 'country',
      getValue: () => 'United States of America',
      fieldTypes: ['dropdown'],
    },
    
    // Work Authorization
    "whether the applicant can legally work in this country without sponsorship": {
      key: 'workAuth',
      getValue: (p) => p.workAuth?.authorizedToWork ? 'Yes' : 'No',
      fieldTypes: ['radio', 'dropdown', 'checkbox'],
    },
    "whether the applicant will need visa sponsorship now or in the future": {
      key: 'sponsorship',
      getValue: (p) => p.workAuth?.requiresSponsorship ? 'Yes' : 'No',
      fieldTypes: ['radio', 'dropdown', 'checkbox'],
    },
    "whether the applicant is a US citizen or permanent resident for export control purposes": {
      key: 'usPerson',
      getValue: (p) => {
        const status = (p.workAuth?.visaStatus || '').toLowerCase();
        const isUSPerson = ['citizen', 'green card', 'permanent resident', 'asylee', 'refugee']
          .some(s => status.includes(s));
        return isUSPerson ? 'Yes' : 'No';
      },
      fieldTypes: ['radio', 'dropdown', 'checkbox'],
    },
    "whether the applicant previously worked at this company": {
      key: 'previousEmployee',
      getValue: (p) => p.additional?.previouslyEmployed ? 'Yes' : 'No',
      fieldTypes: ['radio', 'dropdown'],
    },
    
    // Education
    "the name of a school or university": {
      key: 'school',
      getValue: (p) => p.education?.school,
      fieldTypes: ['text', 'searchable'],
    },
    "the type of academic degree like Bachelor's or Master's": {
      key: 'degree',
      getValue: (p) => {
        const d = (p.education?.degree || '').toLowerCase();
        if (d.includes('master')) return "Master's Degree";
        if (d.includes('bachelor')) return "Bachelor's Degree";
        if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
        if (d.includes('associate')) return "Associate's Degree";
        return p.education?.degree || "Bachelor's Degree";
      },
      fieldTypes: ['dropdown'],
    },
    "the applicant's major or field of study": {
      key: 'fieldOfStudy',
      getValue: (p) => p.education?.fieldOfStudy,
      fieldTypes: ['text', 'searchable'],
    },
    "a graduation date or year": {
      key: 'graduationYear',
      getValue: (p) => p.education?.graduationYear,
      fieldTypes: ['text', 'dropdown', 'date'],
    },
    
    // EEO
    "the applicant's gender identity": {
      key: 'gender',
      getValue: (p) => p.eeo?.gender || 'Decline to Self Identify',
      fieldTypes: ['dropdown', 'radio'],
    },
    "the applicant's race or ethnicity": {
      key: 'ethnicity',
      getValue: (p) => p.eeo?.race || 'Decline to Self Identify',
      fieldTypes: ['dropdown', 'radio'],
    },
    "whether the applicant is a military veteran": {
      key: 'veteran',
      getValue: (p) => {
        const v = (p.eeo?.veteranStatus || '').toLowerCase();
        if (v.includes('not') || !v) return 'I am not a protected veteran';
        return 'I identify as one or more of the classifications';
      },
      fieldTypes: ['dropdown', 'radio'],
    },
    "whether the applicant has a disability": {
      key: 'disability',
      getValue: (p) => {
        const d = (p.eeo?.disabilityStatus || '').toLowerCase();
        if (d.includes('yes')) return 'Yes, I have a disability';
        if (d.includes('not want') || d.includes("don't want")) return 'I do not want to answer';
        return 'No, I do not have a disability';
      },
      fieldTypes: ['dropdown', 'radio', 'checkbox'],
    },
    
    // Employment
    "how the applicant heard about this job opening": {
      key: 'referralSource',
      getValue: (p) => p.referral?.source || 'LinkedIn',
      fieldTypes: ['dropdown', 'searchable', 'text'],
    },
    "the name of an employee who referred the applicant": {
      key: 'referrerName',
      getValue: (p) => p.referral?.referrerName || '',
      fieldTypes: ['text'],
    },
    "the applicant's LinkedIn profile URL": {
      key: 'linkedin',
      getValue: (p) => p.personal?.linkedIn,
      fieldTypes: ['text'],
    },
    "the applicant's website or portfolio URL": {
      key: 'website',
      getValue: (p) => p.personal?.website || p.personal?.portfolio,
      fieldTypes: ['text'],
    },
    
    // Other
    "agreement to terms and conditions": {
      key: 'termsAgreement',
      getValue: () => true,
      fieldTypes: ['checkbox'],
    },
    "a date or signature date": {
      key: 'signatureDate',
      getValue: () => {
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const yyyy = today.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
      },
      fieldTypes: ['date', 'text'],
    },
    "a resume or CV file upload": {
      key: 'resume',
      getValue: (p) => p.documents?.resumePath,
      fieldTypes: ['file'],
    },
    "professional skills or competencies": {
      key: 'skills',
      getValue: (p) => p.skills?.join(', ') || '',
      fieldTypes: ['text', 'searchable'],
    },
  };

  // ============================================
  // MODEL LOADING
  // ============================================
  
  async loadModels() {
    if (this.isLoaded) return;
    
    console.log('[HybridClassifier] Loading ACCURACY-OPTIMIZED models...');
    console.log('[HybridClassifier] This may take 10-15 seconds on first run (downloading ~3GB)');
    const startTime = Date.now();
    
    // Load zero-shot classifier (DeBERTa-v3-large - 435M params)
    console.log(`[HybridClassifier] Loading zero-shot model: ${this.zeroShotModelName}`);
    try {
      this.zeroShotClassifier = await pipeline(
        'zero-shot-classification',
        this.zeroShotModelName,
        {
          // Use fp32 for maximum accuracy (no quantization)
          quantized: false,
          progress_callback: (progress) => {
            if (progress.status === 'downloading' && progress.total > 0) {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              process.stdout.write(`\r[HybridClassifier] Downloading zero-shot: ${pct}%    `);
            }
          }
        }
      );
      console.log('\n[HybridClassifier] ✅ Zero-shot model loaded');
    } catch (error) {
      console.error(`\n[HybridClassifier] ❌ Failed to load ${this.zeroShotModelName}`);
      console.log('[HybridClassifier] Falling back to Xenova/nli-deberta-v3-small');
      this.zeroShotModelName = 'Xenova/nli-deberta-v3-small';
      this.zeroShotClassifier = await pipeline(
        'zero-shot-classification',
        this.zeroShotModelName,
        { quantized: true }
      );
    }
    
    // Load embedding model (BGE-M3 - 568M params, HIGHEST ACCURACY)
    console.log(`[HybridClassifier] Loading embedding model: ${this.embeddingModelName}`);
    try {
      this.featureExtractor = await pipeline(
        'feature-extraction',
        this.embeddingModelName,
        {
          // Use fp16 for good balance of accuracy and memory
          // (fp32 would be ~4.4GB, fp16 is ~2.2GB)
          dtype: 'fp16',
          progress_callback: (progress) => {
            if (progress.status === 'downloading' && progress.total > 0) {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              process.stdout.write(`\r[HybridClassifier] Downloading BGE-M3: ${pct}%    `);
            }
          }
        }
      );
      console.log('\n[HybridClassifier] ✅ BGE-M3 embedding model loaded');
    } catch (error) {
      console.error(`\n[HybridClassifier] ❌ Failed to load ${this.embeddingModelName}: ${error.message}`);
      console.log('[HybridClassifier] Falling back to Xenova/bge-large-en-v1.5');
      this.embeddingModelName = 'Xenova/bge-large-en-v1.5';
      this.featureExtractor = await pipeline(
        'feature-extraction',
        this.embeddingModelName,
        { quantized: true }
      );
    }
    
    // Pre-compute embeddings for field variations
    await this.precomputeFieldEmbeddings();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[HybridClassifier] ✅ All models loaded in ${elapsed}s`);
    console.log(`[HybridClassifier] Zero-shot: ${this.zeroShotModelName}`);
    console.log(`[HybridClassifier] Embeddings: ${this.embeddingModelName}`);
    
    this.isLoaded = true;
  }

  // ============================================
  // PRE-COMPUTE EMBEDDINGS WITH BGE-M3
  // ============================================
  
  async precomputeFieldEmbeddings() {
    console.log('[HybridClassifier] Pre-computing field embeddings with BGE-M3...');
    
    for (const [category, variations] of Object.entries(HybridFieldClassifier.FIELD_VARIATIONS)) {
      // Compute embedding for each variation
      const embeddings = [];
      for (const variation of variations) {
        const embedding = await this.getEmbedding(variation);
        embeddings.push(embedding);
      }
      
      // Store centroid (average) embedding for the category
      const centroid = this.computeCentroid(embeddings);
      this.fieldEmbeddings.set(category, centroid);
    }
    
    console.log(`[HybridClassifier] Pre-computed embeddings for ${this.fieldEmbeddings.size} categories`);
  }

  /**
   * Get embedding using BGE-M3
   * IMPORTANT: BGE-M3 uses CLS pooling, not mean pooling!
   */
  async getEmbedding(text) {
    const result = await this.featureExtractor(text, {
      // BGE-M3 uses CLS token pooling (different from MiniLM which uses mean)
      pooling: 'cls',
      normalize: true
    });
    return Array.from(result.data);
  }

  computeCentroid(embeddings) {
    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);
    
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += emb[i];
      }
    }
    
    for (let i = 0; i < dim; i++) {
      centroid[i] /= embeddings.length;
    }
    
    // Normalize
    const norm = Math.sqrt(centroid.reduce((sum, x) => sum + x * x, 0));
    return centroid.map(x => x / norm);
  }

  cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot; // Already normalized, so dot product = cosine similarity
  }

  // ============================================
  // MAIN CLASSIFICATION METHOD
  // ============================================
  
  async classifyField(fieldInfo) {
    if (!this.isLoaded) {
      await this.loadModels();
    }

    const context = this.buildFieldContext(fieldInfo);
    
    // Check cache first
    const cacheKey = context.toLowerCase().trim();
    if (this.predictionCache.has(cacheKey)) {
      return this.predictionCache.get(cacheKey);
    }

    // Stage 1: Zero-shot classification with DeBERTa-v3-large
    const zeroShotResult = await this.zeroShotClassify(context, fieldInfo.type);
    
    if (zeroShotResult.confidence >= this.zeroShotConfidenceThreshold) {
      const result = {
        label: zeroShotResult.label,
        confidence: zeroShotResult.confidence,
        method: 'zero-shot',
        model: this.zeroShotModelName,
        profileMapping: HybridFieldClassifier.LABEL_TO_PROFILE[zeroShotResult.label],
        allScores: zeroShotResult.allScores,
      };
      this.predictionCache.set(cacheKey, result);
      return result;
    }

    // Stage 2: Semantic similarity fallback with BGE-M3
    const similarityResult = await this.semanticSimilarityMatch(context);
    
    if (similarityResult.score >= this.similarityThreshold) {
      // Map category back to label
      const label = this.categoryToLabel(similarityResult.category);
      const result = {
        label: label,
        confidence: similarityResult.score,
        method: 'semantic-similarity',
        model: this.embeddingModelName,
        profileMapping: HybridFieldClassifier.LABEL_TO_PROFILE[label],
        matchedCategory: similarityResult.category,
      };
      this.predictionCache.set(cacheKey, result);
      return result;
    }

    // Low confidence on both - return best zero-shot guess
    const result = {
      label: zeroShotResult.label,
      confidence: zeroShotResult.confidence,
      method: 'zero-shot-low-confidence',
      model: this.zeroShotModelName,
      profileMapping: HybridFieldClassifier.LABEL_TO_PROFILE[zeroShotResult.label],
      allScores: zeroShotResult.allScores,
      similarityFallback: similarityResult,
    };
    this.predictionCache.set(cacheKey, result);
    return result;
  }

  // ============================================
  // ZERO-SHOT CLASSIFICATION
  // ============================================
  
  async zeroShotClassify(context, fieldType) {
    // Get relevant labels based on field type
    const labels = this.getRelevantLabels(fieldType);
    
    const result = await this.zeroShotClassifier(context, labels, {
      hypothesis_template: this.hypothesisTemplate,
      multi_label: false,
    });

    return {
      label: result.labels[0],
      confidence: result.scores[0],
      allScores: result.labels.slice(0, 5).map((l, i) => ({
        label: l,
        score: result.scores[i]
      })),
    };
  }

  getRelevantLabels(fieldType) {
    // For certain field types, narrow down the candidate labels
    if (fieldType === 'checkbox') {
      return [
        ...HybridFieldClassifier.LABELS.WORK_AUTH,
        ...HybridFieldClassifier.LABELS.EEO,
        "agreement to terms and conditions",
      ];
    }
    
    if (fieldType === 'radio') {
      return [
        ...HybridFieldClassifier.LABELS.WORK_AUTH,
        ...HybridFieldClassifier.LABELS.EEO,
      ];
    }
    
    // For text and dropdown, use all labels
    return HybridFieldClassifier.ALL_LABELS;
  }

  // ============================================
  // SEMANTIC SIMILARITY MATCHING WITH BGE-M3
  // ============================================
  
  async semanticSimilarityMatch(context) {
    const queryEmbedding = await this.getEmbedding(context);
    
    let bestCategory = null;
    let bestScore = -1;
    
    for (const [category, centroid] of this.fieldEmbeddings.entries()) {
      const score = this.cosineSimilarity(queryEmbedding, centroid);
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }
    
    return {
      category: bestCategory,
      score: bestScore,
    };
  }

  categoryToLabel(category) {
    // Map semantic category back to zero-shot label
    const categoryToLabelMap = {
      'work_authorization': "whether the applicant can legally work in this country without sponsorship",
      'visa_sponsorship': "whether the applicant will need visa sponsorship now or in the future",
      'previous_employee': "whether the applicant previously worked at this company",
      'first_name': "the applicant's first name",
      'last_name': "the applicant's last name or family name",
      'referral_source': "how the applicant heard about this job opening",
      'gender': "the applicant's gender identity",
      'ethnicity': "the applicant's race or ethnicity",
      'veteran_status': "whether the applicant is a military veteran",
      'disability_status': "whether the applicant has a disability",
      'email': "an email address",
      'phone': "a phone number",
      'linkedin': "the applicant's LinkedIn profile URL",
    };
    
    return categoryToLabelMap[category] || null;
  }

  // ============================================
  // BUILD FIELD CONTEXT
  // ============================================
  
  buildFieldContext(field) {
    const parts = [];
    
    // Label is most important
    if (field.labelText && field.labelText.trim()) {
      const cleanLabel = field.labelText.replace(/\*/g, '').trim();
      parts.push(`Form field: ${cleanLabel}`);
    }
    
    // Add aria-label if different
    if (field.ariaLabel && field.ariaLabel !== field.labelText) {
      parts.push(`Description: ${field.ariaLabel}`);
    }
    
    // Add placeholder hint
    if (field.placeholder && field.placeholder.trim()) {
      parts.push(`Placeholder: ${field.placeholder}`);
    }
    
    // Add section context
    if (field.sectionHeader && field.sectionHeader.trim()) {
      parts.push(`Section: ${field.sectionHeader}`);
    }
    
    // Fallback to ID
    if (parts.length === 0 && field.id) {
      const readableId = field.id
        .replace(/--/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]/g, ' ')
        .toLowerCase();
      parts.push(`Field ID: ${readableId}`);
    }
    
    return parts.join('. ') || 'Unknown form field';
  }

  // ============================================
  // BATCH CLASSIFICATION
  // ============================================
  
  async classifyFields(fields) {
    if (!this.isLoaded) {
      await this.loadModels();
    }

    const results = [];
    const total = fields.length;
    
    console.log(`[HybridClassifier] Classifying ${total} fields with accuracy-optimized models...`);
    
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      process.stdout.write(`\r[HybridClassifier] Processing ${i + 1}/${total}`);
      
      const classification = await this.classifyField(field);
      
      results.push({
        ...field,
        classification,
      });
    }
    
    console.log(`\n[HybridClassifier] Classification complete`);
    
    // Log summary
    const zeroShotCount = results.filter(r => r.classification.method === 'zero-shot').length;
    const similarityCount = results.filter(r => r.classification.method === 'semantic-similarity').length;
    const lowConfCount = results.filter(r => r.classification.method === 'zero-shot-low-confidence').length;
    
    console.log(`[HybridClassifier] Results: ${zeroShotCount} zero-shot, ${similarityCount} similarity, ${lowConfCount} low-confidence`);
    
    return results;
  }

  // ============================================
  // GET VALUE FOR CLASSIFIED FIELD
  // ============================================
  
  getValueForField(classifiedField, profile) {
    const mapping = classifiedField.classification?.profileMapping;
    
    if (!mapping) {
      console.log(`[HybridClassifier] No mapping for: ${classifiedField.classification?.label}`);
      return null;
    }
    
    const value = mapping.getValue(profile);
    
    return {
      value,
      key: mapping.key,
      fieldTypes: mapping.fieldTypes,
    };
  }

  // ============================================
  // CLEAR CACHE (useful if profile changes)
  // ============================================
  
  clearCache() {
    this.predictionCache.clear();
    console.log('[HybridClassifier] Prediction cache cleared');
  }

  // ============================================
  // GET MODEL INFO
  // ============================================
  
  getModelInfo() {
    return {
      zeroShotModel: this.zeroShotModelName,
      embeddingModel: this.embeddingModelName,
      zeroShotThreshold: this.zeroShotConfidenceThreshold,
      similarityThreshold: this.similarityThreshold,
      isLoaded: this.isLoaded,
      cacheSize: this.predictionCache.size,
      precomputedCategories: this.fieldEmbeddings.size,
    };
  }
}

export default HybridFieldClassifier;

// ============================================
// USAGE EXAMPLE
// ============================================
/*
import HybridFieldClassifier from './hybrid-field-classifier.js';

// Create classifier (accuracy-optimized by default)
const classifier = new HybridFieldClassifier({
  confidenceThreshold: 0.45,  // Zero-shot confidence threshold
  similarityThreshold: 0.6,   // Semantic similarity threshold
});

// Load models (first run downloads ~3GB)
await classifier.loadModels();

// Classify a single field
const result = await classifier.classifyField({
  labelText: 'Are you legally eligible to work in the US?',
  type: 'radio',
});

console.log(result);
// {
//   label: "whether the applicant can legally work in this country without sponsorship",
//   confidence: 0.92,
//   method: "zero-shot",
//   model: "MoritzLaurer/deberta-v3-large-zeroshot-v2.0",
//   profileMapping: { key: 'workAuth', getValue: [Function], fieldTypes: ['radio', 'dropdown', 'checkbox'] }
// }

// Get value from profile
const value = classifier.getValueForField(result, {
  workAuth: { authorizedToWork: true }
});
console.log(value); // { value: 'Yes', key: 'workAuth', fieldTypes: [...] }
*/
