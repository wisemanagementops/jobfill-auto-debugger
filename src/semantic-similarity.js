// ============================================
// STAGE 2: SEMANTIC SIMILARITY CLASSIFIER
// Uses BGE-M3 embeddings for fallback classification
// Triggered when Stage 1 (Zero-Shot) confidence < 45%
// ============================================

import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, '..', 'models');
env.cacheDir = CACHE_DIR;
env.allowLocalModels = true;

class SemanticSimilarityClassifier {
  constructor() {
    this.embedder = null;
    this.isLoaded = false;
    // BGE-M3 is excellent for semantic similarity
    this.modelName = 'Xenova/bge-base-en-v1.5';
    // Pre-computed embeddings for field types (computed on first load)
    this.fieldTypeEmbeddings = null;
  }

  // ============================================
  // FIELD TYPE DEFINITIONS WITH DESCRIPTIONS
  // These are what we compare against
  // ============================================
  static FIELD_TYPES = {
    'first_name': {
      descriptions: [
        'first name of a person',
        'given name',
        'first name field',
        'your first name'
      ],
      getValue: (p) => p.personal?.firstName
    },
    'middle_name': {
      descriptions: [
        'middle name of a person',
        'middle initial',
        'middle name field'
      ],
      getValue: (p) => p.personal?.middleName || null
    },
    'last_name': {
      descriptions: [
        'last name of a person',
        'surname',
        'family name',
        'last name field'
      ],
      getValue: (p) => p.personal?.lastName
    },
    'email': {
      descriptions: [
        'email address',
        'e-mail',
        'electronic mail address'
      ],
      getValue: (p) => p.personal?.email
    },
    'phone_number': {
      descriptions: [
        'phone number',
        'telephone number',
        'contact number',
        'mobile number'
      ],
      getValue: (p) => p.personal?.phone?.replace(/[\(\)\-\s]/g, '')
    },
    'phone_extension': {
      descriptions: [
        'phone extension',
        'extension number',
        'ext'
      ],
      getValue: (p) => null
    },
    'country_phone_code': {
      descriptions: [
        'country phone code',
        'country calling code',
        'international dialing code',
        'phone country code'
      ],
      getValue: (p) => 'United States of America (+1)'
    },
    'address_line_1': {
      descriptions: [
        'address line 1',
        'street address',
        'mailing address',
        'home address',
        'address line one',
        'primary address'
      ],
      getValue: (p) => p.address?.line1
    },
    'address_line_2': {
      descriptions: [
        'address line 2',
        'apartment number',
        'suite number',
        'unit number',
        'address line two'
      ],
      getValue: (p) => p.address?.line2 || null
    },
    'city': {
      descriptions: [
        'city name',
        'city or town',
        'municipality',
        'city field'
      ],
      getValue: (p) => p.address?.city
    },
    'state': {
      descriptions: [
        'state or province',
        'state name',
        'region',
        'state field'
      ],
      getValue: (p) => p.address?.state
    },
    'postal_code': {
      descriptions: [
        'postal code',
        'zip code',
        'postcode',
        'ZIP'
      ],
      getValue: (p) => p.address?.zipCode
    },
    'country': {
      descriptions: [
        'country name',
        'country of residence',
        'nation'
      ],
      getValue: (p) => 'United States of America'
    },
    'linkedin': {
      descriptions: [
        'linkedin profile',
        'linkedin URL',
        'linkedin address'
      ],
      getValue: (p) => p.personal?.linkedIn
    },
    'work_authorization': {
      descriptions: [
        'work authorization',
        'authorized to work',
        'legally eligible to work',
        'work permit status'
      ],
      getValue: (p) => p.workAuth?.authorizedToWork ? 'Yes' : 'No'
    },
    'visa_sponsorship': {
      descriptions: [
        'visa sponsorship',
        'require sponsorship',
        'need visa sponsorship',
        'sponsorship required'
      ],
      getValue: (p) => p.workAuth?.requiresSponsorship ? 'Yes' : 'No'
    },
    'current_visa_status': {
      descriptions: [
        'current visa status',
        'current immigration status',
        'provide your current status',
        'what is your visa type'
      ],
      getValue: (p) => p.workAuth?.visaStatus || 'H1B'
    },
    'j1_j2_visa_history': {
      descriptions: [
        'J-1 or J-2 exchange visitor visa',
        'have you held a J-1 visa',
        'J-1 J-2 visa history',
        'exchange visitor visa'
      ],
      getValue: (p) => p.workAuth?.hadJ1J2Visa ? 'Yes' : 'No'
    },
    'citizenship_country_text': {
      descriptions: [
        'country of citizenship',
        'countries of citizenship',
        'citizenship country name',
        'what country are you a citizen of'
      ],
      getValue: (p) => p.personal?.citizenship || 'India'
    },
    'previous_employee': {
      descriptions: [
        'previous employee',
        'previously worked here',
        'former employee',
        'worked at this company before'
      ],
      getValue: (p) => 'No'
    },
    'referral_source': {
      descriptions: [
        'how did you hear about us',
        'referral source',
        'job source',
        'how did you find this job'
      ],
      getValue: (p) => 'LinkedIn'
    },
    'school': {
      descriptions: [
        'school name',
        'university name',
        'college name',
        'educational institution'
      ],
      getValue: (p) => p.education?.school
    },
    'degree': {
      descriptions: [
        'degree level',
        'education level',
        'academic degree',
        'highest degree'
      ],
      getValue: (p) => {
        const d = (p.education?.degree || '').toLowerCase();
        if (d.includes('master')) return "Master's Degree";
        if (d.includes('bachelor')) return "Bachelor's Degree";
        if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
        return p.education?.degree || "Bachelor's Degree";
      }
    },
    'field_of_study': {
      descriptions: [
        'field of study',
        'major',
        'area of study',
        'concentration'
      ],
      getValue: (p) => p.education?.fieldOfStudy
    },
    'gender': {
      descriptions: [
        'gender',
        'gender identity',
        'sex'
      ],
      getValue: (p) => p.eeo?.gender || 'Decline to Self Identify'
    },
    'ethnicity': {
      descriptions: [
        'ethnicity',
        'race',
        'racial background',
        'ethnic background'
      ],
      getValue: (p) => p.eeo?.race || 'Decline to Self Identify'
    },
    'veteran_status': {
      descriptions: [
        'veteran status',
        'military service',
        'protected veteran'
      ],
      getValue: (p) => 'I am not a protected veteran'
    },
    'disability_status': {
      descriptions: [
        'disability status',
        'disability',
        'disabled'
      ],
      getValue: (p) => 'I do not want to answer'
    }
  };

  // ============================================
  // LOAD MODEL
  // ============================================
  async loadModel() {
    if (this.isLoaded) return;
    
    console.log(`[Semantic] Loading embedding model: ${this.modelName}`);
    
    const startTime = Date.now();
    
    this.embedder = await pipeline('feature-extraction', this.modelName, {
      quantized: true  // BGE works well quantized
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Semantic] Model loaded in ${elapsed}s`);
    
    // Pre-compute embeddings for all field type descriptions
    await this.precomputeFieldEmbeddings();
    
    this.isLoaded = true;
  }

  // ============================================
  // PRE-COMPUTE FIELD TYPE EMBEDDINGS
  // ============================================
  async precomputeFieldEmbeddings() {
    console.log('[Semantic] Pre-computing field type embeddings...');
    
    this.fieldTypeEmbeddings = {};
    
    for (const [fieldType, config] of Object.entries(SemanticSimilarityClassifier.FIELD_TYPES)) {
      // Combine all descriptions into one embedding (average)
      const embeddings = [];
      for (const desc of config.descriptions) {
        const emb = await this.getEmbedding(desc);
        embeddings.push(emb);
      }
      
      // Average the embeddings
      this.fieldTypeEmbeddings[fieldType] = this.averageEmbeddings(embeddings);
    }
    
    console.log(`[Semantic] Pre-computed ${Object.keys(this.fieldTypeEmbeddings).length} field type embeddings`);
  }

  // ============================================
  // GET EMBEDDING FOR TEXT
  // ============================================
  async getEmbedding(text) {
    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  // ============================================
  // AVERAGE MULTIPLE EMBEDDINGS
  // ============================================
  averageEmbeddings(embeddings) {
    if (embeddings.length === 0) return [];
    if (embeddings.length === 1) return embeddings[0];
    
    const dim = embeddings[0].length;
    const avg = new Array(dim).fill(0);
    
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i];
      }
    }
    
    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }
    
    // Normalize
    const norm = Math.sqrt(avg.reduce((sum, val) => sum + val * val, 0));
    return avg.map(val => val / norm);
  }

  // ============================================
  // COSINE SIMILARITY
  // ============================================
  cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ============================================
  // CLASSIFY FIELD USING SEMANTIC SIMILARITY
  // ============================================
  async classifyField(fieldContext) {
    if (!this.isLoaded) {
      await this.loadModel();
    }
    
    // Get embedding for the field context
    const fieldEmbedding = await this.getEmbedding(fieldContext);
    
    // Compare against all field types
    const scores = [];
    
    for (const [fieldType, typeEmbedding] of Object.entries(this.fieldTypeEmbeddings)) {
      const similarity = this.cosineSimilarity(fieldEmbedding, typeEmbedding);
      scores.push({ fieldType, similarity });
    }
    
    // Sort by similarity (highest first)
    scores.sort((a, b) => b.similarity - a.similarity);
    
    const best = scores[0];
    
    return {
      fieldType: best.fieldType,
      similarity: best.similarity,
      topMatches: scores.slice(0, 3)
    };
  }

  // ============================================
  // GET VALUE FOR CLASSIFIED FIELD
  // ============================================
  getValueForFieldType(fieldType, profile) {
    const config = SemanticSimilarityClassifier.FIELD_TYPES[fieldType];
    if (!config) return null;
    return config.getValue(profile);
  }
}

export default SemanticSimilarityClassifier;
