/**
 * Verified Field Classifier v8 - TRUST CASCADE ARCHITECTURE
 * 
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                  TRUST CASCADE v8                                ║
 * ║                                                                  ║
 * ║  TIER 1: CERTAIN (free, instant)                                ║
 * ║  ├── Field ID regex match           → STOP ✅                   ║
 * ║  ├── Exact label in verified cache  → STOP ✅                   ║
 * ║  └── Exact question in bank         → STOP ✅                   ║
 * ║       (exact = token-normalized string match, NOT embedding)     ║
 * ║                                                                  ║
 * ║  TIER 2: UNCERTAIN → CHEAP VERIFICATION                        ║
 * ║  ├── Similar question found (BGE ≥85%)                          ║
 * ║  │   └── Haiku confirms: "Is this asking about {X}?" → $0.001  ║
 * ║  ├── Short label → DeBERTa+BGE agree ≥85%                      ║
 * ║  │   └── Haiku confirms: "Is '{label}' a {X}?" → $0.001        ║
 * ║  └── If Haiku says yes → STOP ✅ (save to exact cache)          ║
 * ║       If Haiku says no → fall to Tier 3                         ║
 * ║                                                                  ║
 * ║  TIER 3: UNKNOWN → CLAUDE OPUS (full classification)            ║
 * ║  ├── Classifies from scratch                                    ║
 * ║  ├── Textarea guard validates                                   ║
 * ║  ├── validateBeforeLearning() checks                            ║
 * ║  └── Saves to cache + question bank (pending review)            ║
 * ║       → Next time this EXACT question → Tier 1 FREE             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * KEY INNOVATION: Haiku as a $0.001 Safety Net
 *   Instead of trusting BGE similarity blindly OR paying $0.015 for Opus,
 *   Haiku verifies uncertain matches for ~$0.001.
 *   15x cheaper than Opus, but still catches subtle differences.
 * 
 * LEARNING FLYWHEEL:
 *   First encounter:  Opus classifies ($0.015) → saved to exact cache
 *   Same question:    Exact cache hit ($0.000) → done
 *   Similar question: Haiku verifies ($0.001) → if confirmed, saved as NEW exact entry
 *                     → next time THIS exact question → $0.000
 *   After ~20-30 apps: 95%+ from exact cache, Haiku handles rest, Opus rarely runs.
 */

import Anthropic from '@anthropic-ai/sdk';
import HierarchicalCache, { detectATS, extractCompany } from './hierarchical-cache-v3.1.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // Tier 3: Opus (full classification from scratch)
  opusModel: 'claude-opus-4-5-20251101',
  opusMaxTokens: 500,
  
  // Tier 2: Haiku (cheap verification yes/no)
  haikuModel: 'claude-haiku-4-5-20251001',
  haikuMaxTokens: 20,
  
  temperature: 0,
  verbose: true,
  
  // Thresholds
  bgeThreshold: 0.85,           // BGE similarity must be ≥ 85% to trigger Tier 2
  debertaThreshold: 0.85,       // DeBERTa confidence must be ≥ 85% to trigger Tier 2
  questionBankThreshold: 0.82,  // BGE match for question bank (Tier 2)
  
  // Paths (set in constructor)
  questionBankPath: null,
  exactCachePath: null,
  reviewQueuePath: null,
  
  // Review mode
  reviewMode: true,
};

// ============================================================================
// ALL KNOWN FIELD TYPES
// ============================================================================
const FIELD_TYPES = [
  // Personal
  'first_name', 'last_name', 'middle_name', 'full_name', 'preferred_name',
  'prefix', 'suffix',
  'email', 'phone_number', 'country_phone_code', 'phone_extension', 'phone_type',
  
  // Address
  'address_line_1', 'address_line_2', 'city', 'state', 'county', 'postal_code', 'country',
  
  // Work Authorization
  'work_authorization', 'work_authorization_indefinite', 'visa_sponsorship',
  'citizenship_status', 'citizenship_country_text', 'restricted_country_citizen', 
  'group_d_country_citizen', 'foreign_permanent_resident',
  'current_visa_status', 'j1_j2_visa_history',
  
  // Employment
  'previously_employed', 'current_employee', 'desired_salary', 'available_start_date',
  'years_of_experience', 'notice_period', 'relative_at_company', 'other_commitments',
  'restrictive_agreement',
  
  // Education
  'school', 'degree', 'field_of_study', 'graduation_year', 'gpa',
  
  // Job Requirements/Qualifications
  'meets_educational_requirements', 'meets_job_requirements',
  
  // Compliance/Background
  'healthcare_exclusion', 'disciplinary_action', 'military_service', 
  'scp_referral', 'kpmg_employment', 'big_four_employment',
  
  // Documents
  'resume_upload', 'cover_letter_upload', 'linkedin', 'website', 'portfolio',
  
  // EEO
  'gender', 'race_ethnicity', 'veteran_status', 'disability_status', 'hispanic_latino',
  
  // Consent
  'terms_agreement', 'ai_recruitment_consent', 'future_opportunities_consent',
  'age_verification', 'minor_work_permit',
  
  // Other
  'referral_source', 'signature_date', 'employee_id', 'skills', 'explanation_text',
  'sponsorship_details',
];

// ============================================================================
// YES/NO FIELD TYPES (textarea guard)
// ============================================================================
const YES_NO_FIELD_TYPES = new Set([
  'work_authorization', 'work_authorization_indefinite', 'visa_sponsorship',
  'citizenship_status', 'restricted_country_citizen', 'group_d_country_citizen',
  'foreign_permanent_resident', 'j1_j2_visa_history',
  'previously_employed', 'current_employee', 'relative_at_company', 'other_commitments',
  'restrictive_agreement', 'age_verification', 'terms_agreement',
  'ai_recruitment_consent', 'future_opportunities_consent', 'hispanic_latino',
  'meets_educational_requirements', 'meets_job_requirements',
  'healthcare_exclusion', 'disciplinary_action',
  'military_service', 'scp_referral', 'kpmg_employment', 'big_four_employment',
]);

// ============================================================================
// FIELD ID PATTERNS (Tier 1 - instant regex match)
// ============================================================================
const FIELD_ID_PATTERNS = [
  // Phone - extension BEFORE phoneNumber!
  { pattern: /--extension$/i, type: 'phone_extension' },
  { pattern: /phoneNumber--phoneNumber/i, type: 'phone_number' },
  { pattern: /countryPhoneCode/i, type: 'country_phone_code' },
  { pattern: /phoneType/i, type: 'phone_type' },
  
  // Workday's countryRegion is STATE!
  { pattern: /countryRegion/i, type: 'state' },
  
  // Name fields
  { pattern: /legalName--firstName/i, type: 'first_name' },
  { pattern: /legalName--lastName/i, type: 'last_name' },
  { pattern: /legalName--middleName/i, type: 'middle_name' },
  
  // Address
  { pattern: /address--addressLine1/i, type: 'address_line_1' },
  { pattern: /address--addressLine2/i, type: 'address_line_2' },
  { pattern: /address--city/i, type: 'city' },
  { pattern: /address--postalCode/i, type: 'postal_code' },
  
  // Education - fieldOfStudy BEFORE school!
  { pattern: /--fieldOfStudy$/i, type: 'field_of_study' },
  { pattern: /--school$/i, type: 'school' },
  { pattern: /--degree$/i, type: 'degree' },
  
  // Employment
  { pattern: /candidateIsPreviousWorker/i, type: 'previously_employed' },
  
  // EEO
  { pattern: /hispanicOrLatino/i, type: 'hispanic_latino' },
  { pattern: /--gender$/i, type: 'gender' },
  { pattern: /veteranStatus/i, type: 'veteran_status' },
  { pattern: /ethnicityMulti/i, type: 'race_ethnicity' },
  { pattern: /--ethnicity$/i, type: 'race_ethnicity' },
  
  // Disability form
  { pattern: /selfIdentifiedDisabilityData--name$/i, type: 'full_name' },
  { pattern: /disabilityStatus/i, type: 'disability_status' },
  { pattern: /employeeId/i, type: 'employee_id' },
  { pattern: /dateSignedOn/i, type: 'signature_date' },
  
  // Other
  { pattern: /source--source/i, type: 'referral_source' },
  { pattern: /skills/i, type: 'skills' },
  { pattern: /acceptTerms/i, type: 'terms_agreement' },
];

// ============================================================================
// ZERO-SHOT LABEL → FIELD_TYPE MAPPING (for DeBERTa)
// ============================================================================
const ZEROSHOT_LABEL_TO_FIELD_TYPE = {
  "a person's first name":                       'first_name',
  "a person's middle name":                      'middle_name',
  "a person's last name or surname":             'last_name',
  "an email address":                            'email',
  "address line 1 or street address":            'address_line_1',
  "address line 2 or apartment number":          'address_line_2',
  "the name of a city or town":                  'city',
  "a state or province or region":               'state',
  "a postal code or zip code":                   'postal_code',
  "a country name":                              'country',
  "a phone number":                              'phone_number',
  "the type of phone device like mobile or home": 'phone_type',
  "a country phone code like +1":                'country_phone_code',
  "a phone extension":                           'phone_extension',
  "a LinkedIn profile URL":                      'linkedin',
  "whether the person previously worked at this company": 'previously_employed',
  "whether the person is a current employee of this company": 'current_employee',
  "how the applicant heard about this job":      'referral_source',
  "whether the person is authorized to work in this country": 'work_authorization',
  "whether the person requires visa sponsorship": 'visa_sponsorship',
  "the person's current visa or immigration status": 'current_visa_status',
  "whether the person has held a J-1 or J-2 exchange visitor visa": 'j1_j2_visa_history',
  "the person's country of citizenship": 'citizenship_country_text',
  "the name of a school or university":          'school',
  "an academic degree level":                    'degree',
  "a field of study or major":                   'field_of_study',
  "a person's gender such as male or female":    'gender',
  "whether the person is Hispanic or Latino":    'hispanic_latino',
  "the applicant's race or ethnicity":           'race_ethnicity',
  "military or veteran status":                  'veteran_status',
  "disability status or accommodation needs":    'disability_status',
  "agreement to terms and conditions":           'terms_agreement',
  "a signature or legal name":                   'full_name',
  "a date":                                      'signature_date',
  "a resume or CV file upload":                  'resume_upload',
};

// ============================================================================
// GENERIC LABELS (too ambiguous for label-based caching)
// ============================================================================
const GENERIC_LABELS = new Set([
  'select one', 'select', 'choose one', 'choose', 'yes', 'no',
  'please select', 'select option', '',
]);

function isGenericLabel(label) {
  return GENERIC_LABELS.has((label || '').toLowerCase().replace(/[*:\s]+/g, ' ').trim());
}

// ============================================================================
// TOKEN NORMALIZATION (for exact matching — Tier 1)
// Strips punctuation, lowercases, collapses whitespace, sorts tokens
// "Are you authorized to work in the US?" === "are authorized in the to us work you"
// ============================================================================
function normalizeForExactMatch(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')    // Strip punctuation
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim()
    .split(' ')
    .sort()                           // Sort tokens for order-independent matching
    .join(' ');
}

// ============================================================================
// VERIFIED FIELD CLASSIFIER v8 - TRUST CASCADE
// ============================================================================
class VerifiedFieldClassifier {
  constructor(options = {}) {
    this.profile = options.profile || null;
    this.stage1Classifier = options.stage1Classifier || null;  // DeBERTa Zero-Shot
    this.stage2Classifier = options.stage2Classifier || null;  // BGE Semantic
    
    // Claude API client (used for both Haiku and Opus)
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
    
    // Hierarchical Cache (for Field ID patterns + learned patterns)
    this.cache = new HierarchicalCache({
      cacheDir: options.cacheDir || './cache',
    });
    
    // Context
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Page context
    this.pageFields = [];
    this.currentFieldIndex = 0;
    
    // ══════════════════════════════════════════════════════
    // EXACT CACHE: Token-normalized question → field_type
    // Used in Tier 1 for FREE instant lookups.
    // Grows from Opus classifications + Haiku confirmations.
    // ══════════════════════════════════════════════════════
    const cacheDir = options.cacheDir || './cache';
    CONFIG.exactCachePath = options.exactCachePath ||
      path.join(cacheDir, 'exact-question-cache.json');
    this.exactCache = {};  // { normalizedQuestion: { field_type, original_text, source, added_at } }
    this.loadExactCache();
    
    // ══════════════════════════════════════════════════════
    // QUESTION BANK: For BGE similarity matching (Tier 2)
    // Same format as v7, used for finding SIMILAR questions.
    // ══════════════════════════════════════════════════════
    CONFIG.questionBankPath = options.questionBankPath || 
      path.join(cacheDir, 'questionnaire-bank.json');
    this.questionBank = [];
    this.questionBankEmbeddings = [];
    this.questionBankReady = false;
    this.loadQuestionBank();
    
    // ══════════════════════════════════════════════════════
    // REVIEW QUEUE (same as v7)
    // ══════════════════════════════════════════════════════
    CONFIG.reviewQueuePath = options.reviewQueuePath ||
      path.join(cacheDir, 'review-queue.json');
    this.reviewQueue = [];
    this.loadReviewQueue();
    
    // ══════════════════════════════════════════════════════
    // STATISTICS
    // ══════════════════════════════════════════════════════
    this.stats = {
      totalFields: 0,
      // Tier 1 (free)
      tier1_fieldId: 0,
      tier1_exactCache: 0,
      tier1_exactQuestion: 0,
      // Tier 2 (Haiku verification ~$0.001)
      tier2_haikuVerified: 0,
      tier2_haikuRejected: 0,
      tier2_haikuCalls: 0,
      // Tier 3 (Opus ~$0.015)
      tier3_opus: 0,
      // Learning
      patternsLearned: 0,
      pendingReview: 0,
      exactCacheSize: 0,
      // Failures
      failed: 0,
    };
  }
  
  // ============================================================================
  // SET APPLICATION CONTEXT
  // ============================================================================
  setApplicationContext(url) {
    this.currentATS = detectATS(url);
    this.currentCompany = extractCompany(url);
    this.cache.setContext(url);
    
    if (CONFIG.verbose) {
      console.log('\n' + '═'.repeat(60));
      console.log('🎯 APPLICATION CONTEXT SET (Trust Cascade v8)');
      console.log('═'.repeat(60));
      console.log(`   URL: ${url ? url.substring(0, 60) + '...' : '(none)'}`);
      console.log(`   ATS Platform: ${this.currentATS}`);
      console.log(`   Company: ${this.currentCompany}`);
      console.log(`   Exact Cache: ${Object.keys(this.exactCache).length} entries`);
      console.log(`   Question Bank: ${this.questionBank.length} questions`);
      console.log('═'.repeat(60) + '\n');
    }
  }
  
  setProfile(profile) {
    this.profile = profile;
  }
  
  setPageFields(fields) {
    this.pageFields = fields || [];
    this.currentFieldIndex = 0;
  }
  
  // ============================================================================
  // EXACT CACHE: Load / Save / Lookup / Add
  // Token-normalized string matching. No embeddings, no AI. FREE.
  // ============================================================================
  
  loadExactCache() {
    try {
      if (fs.existsSync(CONFIG.exactCachePath)) {
        this.exactCache = JSON.parse(fs.readFileSync(CONFIG.exactCachePath, 'utf-8'));
        console.log(`[ExactCache] Loaded ${Object.keys(this.exactCache).length} exact entries`);
      } else {
        // Seed from question bank if available
        this._seedExactCacheFromQuestionBank();
      }
    } catch (error) {
      console.warn(`[ExactCache] Load error: ${error.message}`);
      this.exactCache = {};
    }
  }
  
  _seedExactCacheFromQuestionBank() {
    // Pre-populate exact cache from the seed question bank
    const seedPath = path.join(__dirname, 'questionnaire-bank.json');
    let questions = [];
    
    try {
      if (fs.existsSync(seedPath)) {
        const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        questions = data.questions || [];
      }
    } catch (e) {
      // No seed file, that's fine
    }
    
    for (const q of questions) {
      const normalized = normalizeForExactMatch(q.text);
      if (normalized.length > 10) {
        this.exactCache[normalized] = {
          field_type: q.field_type,
          original_text: q.text,
          source: 'seed',
          added_at: new Date().toISOString(),
        };
      }
    }
    
    if (questions.length > 0) {
      console.log(`[ExactCache] Seeded ${Object.keys(this.exactCache).length} entries from question bank`);
      this.saveExactCache();
    }
  }
  
  saveExactCache() {
    try {
      const cacheDir = path.dirname(CONFIG.exactCachePath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(CONFIG.exactCachePath, JSON.stringify(this.exactCache, null, 2));
    } catch (error) {
      console.warn(`[ExactCache] Save error: ${error.message}`);
    }
  }
  
  lookupExactCache(questionText) {
    if (!questionText) return null;
    const normalized = normalizeForExactMatch(questionText);
    if (normalized.length < 10) return null;
    
    const entry = this.exactCache[normalized];
    if (entry) {
      return {
        fieldType: entry.field_type,
        source: `exact_cache_${entry.source}`,
        originalText: entry.original_text,
      };
    }
    return null;
  }
  
  addToExactCache(questionText, fieldType, source = 'learned') {
    if (!questionText || !fieldType || questionText.length < 15) return;
    const normalized = normalizeForExactMatch(questionText);
    if (normalized.length < 10) return;
    
    // Don't overwrite existing entries
    if (this.exactCache[normalized]) return;
    
    this.exactCache[normalized] = {
      field_type: fieldType,
      original_text: questionText.substring(0, 500),
      source,
      added_at: new Date().toISOString(),
    };
    
    this.saveExactCache();
    console.log(`   📝 EXACT CACHE +1: "${questionText.substring(0, 50)}..." → ${fieldType} [${source}]`);
  }
  
  // ============================================================================
  // QUESTION BANK: Load, BGE match, save (same as v7)
  // ============================================================================
  
  loadQuestionBank() {
    try {
      if (fs.existsSync(CONFIG.questionBankPath)) {
        const data = JSON.parse(fs.readFileSync(CONFIG.questionBankPath, 'utf-8'));
        this.questionBank = data.questions || [];
        console.log(`[QuestionBank] Loaded ${this.questionBank.length} known questions`);
      } else {
        const seedPath = path.join(__dirname, 'questionnaire-bank.json');
        if (fs.existsSync(seedPath)) {
          const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
          this.questionBank = data.questions || [];
          const cacheDir = path.dirname(CONFIG.questionBankPath);
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(CONFIG.questionBankPath, JSON.stringify(data, null, 2));
          console.log(`[QuestionBank] Initialized from seed: ${this.questionBank.length} questions`);
        } else {
          this.questionBank = [];
        }
      }
    } catch (error) {
      console.warn(`[QuestionBank] Load error: ${error.message}`);
      this.questionBank = [];
    }
  }
  
  async precomputeQuestionBankEmbeddings() {
    if (this.questionBankReady || !this.stage2Classifier || this.questionBank.length === 0) return;
    
    if (!this.stage2Classifier.isLoaded) {
      await this.stage2Classifier.loadModel();
    }
    
    console.log(`[QuestionBank] Computing BGE embeddings for ${this.questionBank.length} questions...`);
    const startTime = Date.now();
    
    this.questionBankEmbeddings = [];
    for (const entry of this.questionBank) {
      try {
        const embedding = await this.stage2Classifier.getEmbedding(entry.text);
        this.questionBankEmbeddings.push(embedding);
      } catch (error) {
        this.questionBankEmbeddings.push(null);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[QuestionBank] ${this.questionBankEmbeddings.filter(e => e).length} embeddings ready (${elapsed}s)`);
    this.questionBankReady = true;
  }
  
  async findSimilarQuestion(questionText) {
    if (!this.questionBankReady) {
      await this.precomputeQuestionBankEmbeddings();
    }
    
    if (!this.stage2Classifier || !this.questionBankReady || this.questionBank.length === 0) {
      return null;
    }
    
    if (!questionText || questionText.length < 15) return null;
    
    try {
      const questionEmbedding = await this.stage2Classifier.getEmbedding(questionText);
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (let i = 0; i < this.questionBank.length; i++) {
        const bankEmbedding = this.questionBankEmbeddings[i];
        if (!bankEmbedding) continue;
        
        const similarity = this.stage2Classifier.cosineSimilarity(questionEmbedding, bankEmbedding);
        if (similarity > bestScore) {
          bestScore = similarity;
          bestMatch = this.questionBank[i];
        }
      }
      
      if (bestMatch && bestScore >= CONFIG.questionBankThreshold) {
        return {
          fieldType: bestMatch.field_type,
          confidence: bestScore,
          matchedQuestion: bestMatch.text,
          source: bestMatch.source,
        };
      }
      
      return null;
    } catch (error) {
      console.warn(`      ⚠️ Question bank match error: ${error.message}`);
      return null;
    }
  }
  
  saveQuestionBank() {
    try {
      const cacheDir = path.dirname(CONFIG.questionBankPath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      
      const data = {
        version: 2,
        updated: new Date().toISOString(),
        questions: this.questionBank,
      };
      fs.writeFileSync(CONFIG.questionBankPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[QuestionBank] Save error: ${error.message}`);
    }
  }
  
  async learnQuestionToBank(questionText, fieldType) {
    if (!questionText || !fieldType || questionText.length < 15) return;
    
    // Deduplicate: check if very similar already exists
    if (this.questionBankReady && this.stage2Classifier) {
      try {
        const newEmb = await this.stage2Classifier.getEmbedding(questionText);
        
        for (let i = 0; i < this.questionBankEmbeddings.length; i++) {
          const existing = this.questionBankEmbeddings[i];
          if (!existing) continue;
          const sim = this.stage2Classifier.cosineSimilarity(newEmb, existing);
          if (sim > 0.95 && this.questionBank[i].field_type === fieldType) {
            return; // Already have a very similar question
          }
        }
        
        // Add to bank
        const entry = { text: questionText, field_type: fieldType, source: 'learned' };
        this.questionBank.push(entry);
        this.questionBankEmbeddings.push(newEmb);
        
        console.log(`   📚 QUESTION BANK +1: "${questionText.substring(0, 60)}..." → ${fieldType}`);
        this.saveQuestionBank();
      } catch (error) {
        console.warn(`[QuestionBank] Learn error: ${error.message}`);
      }
    }
  }
  
  // ============================================================================
  // REVIEW QUEUE (same as v7)
  // ============================================================================
  
  loadReviewQueue() {
    try {
      if (fs.existsSync(CONFIG.reviewQueuePath)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG.reviewQueuePath, 'utf-8'));
        this.reviewQueue = raw.items || [];
        
        const approved = this.reviewQueue.filter(item => item.status === 'approved');
        const rejected = this.reviewQueue.filter(item => item.status === 'rejected');
        const pending = this.reviewQueue.filter(item => item.status === 'pending');
        
        if (approved.length > 0) {
          console.log(`[ReviewQueue] Processing ${approved.length} approved pattern(s)...`);
          for (const item of approved) {
            if (item.store === 'question_bank') {
              const exists = this.questionBank.some(q => 
                q.text === item.question && q.field_type === item.field_type
              );
              if (!exists) {
                this.questionBank.push({ 
                  text: item.question, 
                  field_type: item.field_type, 
                  source: 'approved' 
                });
                // Also add to exact cache
                this.addToExactCache(item.question, item.field_type, 'approved');
                console.log(`   ✅ → Question Bank + Exact Cache: "${item.question.substring(0, 50)}..." → ${item.field_type}`);
              }
            } else if (item.store === 'cache') {
              this.cache.learnPattern(
                { label: item.label, id: item.fieldId, section: item.section },
                item.field_type,
                'approved'
              );
              console.log(`   ✅ → Cache: "${item.label}" → ${item.field_type}`);
            }
          }
          this.saveQuestionBank();
        }
        
        if (rejected.length > 0) {
          console.log(`[ReviewQueue] Removed ${rejected.length} rejected pattern(s)`);
        }
        
        this.reviewQueue = pending;
        this.saveReviewQueue();
        
        if (pending.length > 0) {
          console.log(`[ReviewQueue] ${pending.length} pattern(s) still pending review`);
        }
      }
    } catch (error) {
      console.warn(`[ReviewQueue] Load error: ${error.message}`);
      this.reviewQueue = [];
    }
  }
  
  addToReviewQueue(item) {
    const isDupe = this.reviewQueue.some(existing =>
      existing.field_type === item.field_type &&
      existing.label === item.label &&
      existing.store === item.store
    );
    if (isDupe) return;
    
    this.reviewQueue.push({
      ...item,
      status: 'pending',
      timestamp: new Date().toISOString(),
    });
    this.stats.pendingReview++;
    this.saveReviewQueue();
    
    console.log(`   🔍 PENDING REVIEW: "${(item.question || item.label || '').substring(0, 60)}..." → ${item.field_type}`);
  }
  
  saveReviewQueue() {
    try {
      const cacheDir = path.dirname(CONFIG.reviewQueuePath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      
      const data = {
        instructions: "Review each item. Change status to 'approved' or 'rejected'. Approved items get saved permanently on next run.",
        updated: new Date().toISOString(),
        items: this.reviewQueue,
      };
      fs.writeFileSync(CONFIG.reviewQueuePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[ReviewQueue] Save error: ${error.message}`);
    }
  }
  
  printReviewQueueSummary() {
    const pending = this.reviewQueue.filter(item => item.status === 'pending');
    if (pending.length === 0) return;
    
    console.log('\n' + '═'.repeat(65));
    console.log('🔍 REVIEW QUEUE — PATTERNS AWAITING YOUR APPROVAL');
    console.log('═'.repeat(65));
    console.log(`   File: ${CONFIG.reviewQueuePath}`);
    console.log(`   Items: ${pending.length} pending`);
    console.log('─'.repeat(65));
    
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const text = item.question || item.label || '(no text)';
      console.log(`   [${i + 1}] ${item.field_type}`);
      console.log(`       Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
      console.log(`       Answer: "${item.answer || '?'}" | Store: ${item.store} | Source: ${item.source}`);
    }
    
    console.log('─'.repeat(65));
    console.log(`   ✏️  Edit ${CONFIG.reviewQueuePath}`);
    console.log(`   Change "status": "pending" → "approved" or "rejected"`);
    console.log('═'.repeat(65) + '\n');
  }
  
  // ============================================================================
  // QUESTION TEXT EXTRACTION (same as v7)
  // ============================================================================
  extractQuestionText(field) {
    const sectionText = field.section || field.fullText || '';
    if (!sectionText || sectionText.length < 20) return null;
    
    const sectionParts = sectionText.split(' | ').filter(s => s.trim().length > 15);
    if (sectionParts.length === 0) return null;
    
    const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
    const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
    
    if (genericIndex >= 0 && genericIndex < sectionParts.length) {
      return sectionParts[genericIndex].substring(0, 500).trim();
    }
    
    const longest = sectionParts.reduce((a, b) => a.length > b.length ? a : b, '');
    return longest.substring(0, 500).trim();
  }
  
  // ============================================================================
  // BUILD AI CONTEXT (same as v7)
  // ============================================================================
  buildAIContext(field) {
    const parts = [];
    
    const label = (field.label || '').replace(/\*/g, '').trim();
    const generic = isGenericLabel(label);
    
    if (!generic && label) {
      parts.push(`This form field asks for: ${label}`);
    }
    
    if (field.type === 'text' || field.type === 'textarea') {
      parts.push('It is a text input field');
    } else if (field.type === 'dropdown') {
      parts.push('It is a dropdown selection');
    } else if (field.type === 'radio') {
      parts.push('It is a radio button choice');
    } else if (field.type === 'checkbox') {
      parts.push('It is a checkbox');
    }
    
    if (field.section) {
      if (generic && this.pageFields.length > 0) {
        const sectionParts = field.section.split(' | ').filter(s => s.trim().length > 15);
        const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
        const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
        
        if (genericIndex >= 0 && genericIndex < sectionParts.length) {
          const question = sectionParts[genericIndex].substring(0, 300);
          parts.push(`Question: ${question}`);
        } else {
          const allQuestions = sectionParts.map(s => s.substring(0, 200)).join(' | ');
          parts.push(`Context: ${allQuestions.substring(0, 400)}`);
        }
      } else {
        const sectionParts = field.section.split(' | ');
        const relevantSection = sectionParts.find(s => s.length > 15) || sectionParts[0];
        if (relevantSection && relevantSection.length > 10) {
          parts.push(`Context: ${relevantSection.substring(0, 200)}`);
        }
      }
    }
    
    if (field.ariaLabel && field.ariaLabel !== label) {
      parts.push(`Description: ${field.ariaLabel}`);
    }
    
    if (field.options && field.options.length > 0) {
      const optText = field.options.slice(0, 5).map(o => o.label || o.value || o).join(', ');
      parts.push(`Options include: ${optText}`);
    }
    
    if (parts.length === 0 && field.id) {
      const readableId = field.id
        .replace(/--/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]/g, ' ')
        .toLowerCase();
      parts.push(`Form field with ID: ${readableId}`);
    }
    
    return parts.join('. ') || 'Unknown form field';
  }
  
  // ============================================================================
  // TEXTAREA GUARD (same as v7)
  // ============================================================================
  async textareaGuard(field, classifiedType, source) {
    if (field.type !== 'textarea' || !YES_NO_FIELD_TYPES.has(classifiedType)) {
      return null;
    }
    
    console.log(`      ⚠️ TEXTAREA GUARD: "${classifiedType}" is Yes/No but field is textarea`);
    console.log(`         Re-classifying with Claude...`);
    
    if (!this.client) {
      return this._textareaKeywordFallback(field, classifiedType);
    }
    
    const label = field.label || field.name || field.id || '';
    const sectionText = field.section || field.fullText || '';
    
    const previousAnswer = label.match(/\*\s*(Yes|No)\s*$/i)?.[1] || '';
    const previousAnswerHint = previousAnswer 
      ? `\nIMPORTANT: The label ends with "*${previousAnswer}" — this means the applicant already answered "${previousAnswer}" to a PREVIOUS dropdown. This textarea is a FOLLOW-UP asking for additional details.`
      : '';
    
    const prompt = `A job application has a TEXTAREA field (multi-line text input, NOT a dropdown).
The form scraper captured this label: "${label.substring(0, 400)}"
Section context: "${sectionText.substring(0, 300)}"
Field ID: "${field.id || ''}"
${previousAnswerHint}

This textarea is asking for FREE TEXT input. It is NOT asking a Yes/No question.
Common textarea answers include: a country name, a visa type like "H1B", an explanation, etc.

What FREE TEXT information is this textarea asking for? Pick the best field_type:
${FIELD_TYPES.filter(t => !YES_NO_FIELD_TYPES.has(t)).join(', ')}

Respond with ONLY the field_type.`;
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.haikuModel,  // Use Haiku for textarea guard (cheap)
        max_tokens: 50,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      
      if (text && FIELD_TYPES.includes(text) && !YES_NO_FIELD_TYPES.has(text)) {
        console.log(`      🔄 Textarea guard: ${classifiedType} → ${text}`);
        return {
          field_type: text,
          confidence: 0.90,
          source: 'textarea_guard',
        };
      }
      
      console.log(`      ⚠️ Guard reclassification returned "${text}" (still Yes/No or invalid)`);
    } catch (error) {
      console.warn(`      ⚠️ Textarea guard API error: ${error.message}`);
    }
    
    return this._textareaKeywordFallback(field, classifiedType);
  }
  
  _textareaKeywordFallback(field, classifiedType) {
    const label = (field.label || field.section || '').toLowerCase();
    
    // Check for "If yes, please explain" type fields
    if (label.includes('if yes') || 
        label.includes('please explain') || 
        label.includes('provide details') ||
        label.includes('provide an explanation')) {
      console.log(`      🔄 Textarea keyword fallback: ${classifiedType} → explanation_text`);
      return { field_type: 'explanation_text', confidence: 0.85, source: 'textarea_guard_keyword' };
    }
    
    if (label.includes('citizen') || label.includes('citizenship') || label.includes('country')) {
      console.log(`      🔄 Textarea keyword fallback: ${classifiedType} → citizenship_country_text`);
      return { field_type: 'citizenship_country_text', confidence: 0.80, source: 'textarea_guard_keyword' };
    }
    
    if (label.includes('authorized to work') || label.includes('visa') || label.includes('status') || label.includes('immigration')) {
      console.log(`      🔄 Textarea keyword fallback: ${classifiedType} → current_visa_status`);
      return { field_type: 'current_visa_status', confidence: 0.80, source: 'textarea_guard_keyword' };
    }
    
    console.log(`      🚫 Textarea guard: BLOCKED "${classifiedType}" (Yes/No on textarea). No keyword match.`);
    return { field_type: 'explanation_text', confidence: 0.50, source: 'textarea_guard_blocked' };
  }
  
  // ============================================================================
  // VALIDATE BEFORE LEARNING (same as v7)
  // ============================================================================
  validateBeforeLearning(field, fieldType) {
    if (field.type === 'textarea' && YES_NO_FIELD_TYPES.has(fieldType)) {
      return { valid: false, reason: `Yes/No type "${fieldType}" on textarea` };
    }
    
    const TEXT_ONLY_TYPES = new Set([
      'citizenship_country_text', 'current_visa_status', 'skills',
      'first_name', 'last_name', 'middle_name', 'full_name', 'preferred_name',
      'email', 'phone_number', 'address_line_1', 'address_line_2',
      'city', 'postal_code',
    ]);
    
    if (field.type === 'dropdown' && TEXT_ONLY_TYPES.has(fieldType)) {
      return { valid: false, reason: `Text type "${fieldType}" on dropdown` };
    }
    
    const questionText = (field.section || field.label || '').toLowerCase();
    const KEYWORD_CHECKS = [
      { keywords: ['j-1', 'j-2', 'j1', 'j2', 'exchange visitor'], 
        expected: 'j1_j2_visa_history', 
        wrong: ['visa_sponsorship', 'work_authorization'] },
      { keywords: ['country of citizenship', 'countries of citizenship'], 
        expected: 'citizenship_country_text', 
        wrong: ['group_d_country_citizen', 'restricted_country_citizen'] },
      { keywords: ['current status', 'current visa', 'visa type', 'immigration status'], 
        expected: 'current_visa_status', 
        wrong: ['work_authorization', 'visa_sponsorship'] },
      { keywords: ['disability'], 
        expected: 'disability_status', 
        wrong: ['terms_agreement', 'age_verification'] },
    ];
    
    for (const check of KEYWORD_CHECKS) {
      const matchedKeyword = check.keywords.find(k => questionText.includes(k));
      if (matchedKeyword && check.wrong.includes(fieldType)) {
        return { valid: false, reason: `Question has "${matchedKeyword}" but classified as "${fieldType}"` };
      }
    }
    
    return { valid: true };
  }
  
  // ============================================================================
  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║                     MAIN CLASSIFICATION - TRUST CASCADE                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  // ============================================================================
  async classifyField(field) {
    this.stats.totalFields++;
    this.currentFieldIndex++;
    
    const label = field.label || field.name || field.id || 'unknown';
    const generic = isGenericLabel(field.label);
    console.log(`\n   📋 Classifying: "${label.substring(0, 60)}..."`);
    
    // ═══════════════════════════════════════════════
    // TIER 1: CERTAIN (free, instant) → STOP ✅
    // ═══════════════════════════════════════════════
    const tier1Result = await this._tier1Certain(field, generic);
    if (tier1Result) {
      // Textarea guard still applies
      const guardResult = await this.textareaGuard(field, tier1Result.field_type, tier1Result.source);
      if (guardResult) {
        const answer = this.getAnswerFromProfile(guardResult.field_type, field);
        return { ...guardResult, answer };
      }
      
      const answer = this.getAnswerFromProfile(tier1Result.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      return { ...tier1Result, answer };
    }
    
    // ═══════════════════════════════════════════════
    // TIER 2: UNCERTAIN → HAIKU VERIFICATION (~$0.001)
    // ═══════════════════════════════════════════════
    const tier2Result = await this._tier2HaikuVerify(field, generic);
    if (tier2Result) {
      // Textarea guard
      const guardResult = await this.textareaGuard(field, tier2Result.field_type, tier2Result.source);
      if (guardResult) {
        const answer = this.getAnswerFromProfile(guardResult.field_type, field);
        return { ...guardResult, answer };
      }
      
      const answer = this.getAnswerFromProfile(tier2Result.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      return { ...tier2Result, answer };
    }
    
    // ═══════════════════════════════════════════════
    // TIER 3: UNKNOWN → CLAUDE OPUS (full, ~$0.015)
    // ═══════════════════════════════════════════════
    console.log(`      🌐 TIER 3: Opus full classification...`);
    const tier3Result = await this._tier3OpusFull(field, generic);
    if (tier3Result) {
      // Special case: Opus provided a direct answer (intelligent fallback)
      if (tier3Result.field_type === 'opus_direct_answer' && tier3Result.direct_answer) {
        console.log(`      🎯 Using Opus direct answer: "${tier3Result.direct_answer}"`);
        return { 
          field_type: 'opus_direct_answer', 
          confidence: tier3Result.confidence, 
          source: tier3Result.source,
          answer: tier3Result.direct_answer 
        };
      }
      
      // Normal case: Opus classified into a known field_type
      // Textarea guard
      const guardResult = await this.textareaGuard(field, tier3Result.field_type, tier3Result.source);
      if (guardResult) {
        const answer = this.getAnswerFromProfile(guardResult.field_type, field);
        // Learn corrected classification
        if (!isGenericLabel(field.label)) {
          this.cache.learnPattern(field, guardResult.field_type, 'textarea_guard');
          this.stats.patternsLearned++;
        }
        return { ...guardResult, answer };
      }
      
      const answer = this.getAnswerFromProfile(tier3Result.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      return { ...tier3Result, answer };
    }
    
    // All tiers failed
    this.stats.failed++;
    console.log(`      ❌ All tiers failed — could not classify`);
    return { field_type: 'unknown', confidence: 0, source: 'failed', answer: null };
  }
  
  // ============================================================================
  // TIER 1: CERTAIN — Free, instant, no AI
  // ============================================================================
  async _tier1Certain(field, generic) {
    // ─── 1A: Field ID regex match ───
    const fieldId = field.id || field.name || '';
    if (fieldId) {
      for (const { pattern, type } of FIELD_ID_PATTERNS) {
        if (pattern.test(fieldId)) {
          this.stats.tier1_fieldId++;
          console.log(`      ✅ TIER 1 (Field ID): ${type} [${pattern}]`);
          return { field_type: type, confidence: 0.95, source: 'tier1_field_id' };
        }
      }
    }
    
    // ─── 1B: Exact label in verified cache ───
    if (!generic) {
      const cached = this.cache.checkLearnedPatterns(field);
      if (cached && cached.verified) {
        this.stats.tier1_exactCache++;
        console.log(`      ✅ TIER 1 (Verified Cache): ${cached.field_type} [verified]`);
        return { field_type: cached.field_type, confidence: 0.95, source: 'tier1_verified_cache' };
      }
    }
    
    // ─── 1C: Exact question in exact cache ───
    const questionText = this.extractQuestionText(field);
    if (questionText) {
      const exactMatch = this.lookupExactCache(questionText);
      if (exactMatch) {
        this.stats.tier1_exactQuestion++;
        console.log(`      ✅ TIER 1 (Exact Question): ${exactMatch.fieldType} [${exactMatch.source}]`);
        console.log(`         Q: "${questionText.substring(0, 60)}..."`);
        return { field_type: exactMatch.fieldType, confidence: 0.95, source: exactMatch.source };
      }
    }
    
    // ─── 1D: Also check label itself as exact match ───
    if (!generic && field.label && field.label.length > 15) {
      const labelExact = this.lookupExactCache(field.label);
      if (labelExact) {
        this.stats.tier1_exactQuestion++;
        console.log(`      ✅ TIER 1 (Exact Label): ${labelExact.fieldType} [${labelExact.source}]`);
        return { field_type: labelExact.fieldType, confidence: 0.95, source: labelExact.source };
      }
    }
    
    console.log(`      ⬇️ Tier 1: no match`);
    return null;
  }
  
  // ============================================================================
  // TIER 2: UNCERTAIN → HAIKU VERIFICATION (~$0.001)
  // ============================================================================
  async _tier2HaikuVerify(field, generic) {
    const questionText = this.extractQuestionText(field);
    
    // ─── 2A: BGE question similarity ≥85% → Haiku confirms ───
    if (questionText) {
      const bgeMatch = await this.findSimilarQuestion(questionText);
      if (bgeMatch && bgeMatch.confidence >= CONFIG.bgeThreshold) {
        console.log(`      🔍 TIER 2: BGE found similar question: "${bgeMatch.matchedQuestion.substring(0, 50)}..." → ${bgeMatch.fieldType} (${(bgeMatch.confidence * 100).toFixed(1)}%)`);
        
        // Ask Haiku to confirm
        const haikuConfirmed = await this._haikuConfirmQuestion(
          questionText, 
          bgeMatch.fieldType,
          bgeMatch.matchedQuestion
        );
        
        if (haikuConfirmed) {
          this.stats.tier2_haikuVerified++;
          console.log(`      ✅ TIER 2 (Haiku confirmed): ${bgeMatch.fieldType}`);
          
          // LEARNING FLYWHEEL: Save to exact cache for next time (FREE)
          this.addToExactCache(questionText, bgeMatch.fieldType, 'haiku_confirmed');
          
          return { field_type: bgeMatch.fieldType, confidence: 0.92, source: 'tier2_haiku_confirmed' };
        } else {
          this.stats.tier2_haikuRejected++;
          console.log(`      ⚠️ TIER 2: Haiku REJECTED BGE match — falling to Tier 3`);
        }
      }
    }
    
    // ─── 2B: Short label → DeBERTa + BGE agree ≥85% → Haiku confirms ───
    if (!generic && !questionText) {
      const aiContext = this.buildAIContext(field);
      
      // Run DeBERTa
      let debertaResult = null;
      if (this.stage1Classifier) {
        try {
          const zsResult = await this.stage1Classifier.classifyField(aiContext, field.type);
          const fieldType = ZEROSHOT_LABEL_TO_FIELD_TYPE[zsResult.label] || null;
          if (fieldType && zsResult.confidence >= CONFIG.debertaThreshold) {
            debertaResult = { fieldType, confidence: zsResult.confidence };
          }
        } catch (error) {
          console.warn(`      ⚠️ DeBERTa error: ${error.message}`);
        }
      }
      
      // Run BGE
      let bgeResult = null;
      if (this.stage2Classifier) {
        try {
          const semResult = await this.stage2Classifier.classifyField(aiContext);
          if (semResult && semResult.fieldType && semResult.similarity >= CONFIG.bgeThreshold) {
            bgeResult = { fieldType: semResult.fieldType, confidence: semResult.similarity };
          }
        } catch (error) {
          console.warn(`      ⚠️ BGE error: ${error.message}`);
        }
      }
      
      // Both agree with high confidence?
      if (debertaResult && bgeResult && debertaResult.fieldType === bgeResult.fieldType) {
        const agreedType = debertaResult.fieldType;
        const maxConf = Math.max(debertaResult.confidence, bgeResult.confidence);
        
        console.log(`      🔍 TIER 2: DeBERTa+BGE agree: ${agreedType} (D:${(debertaResult.confidence * 100).toFixed(0)}% B:${(bgeResult.confidence * 100).toFixed(0)}%)`);
        
        // Ask Haiku to confirm
        const haikuConfirmed = await this._haikuConfirmLabel(
          field.label || aiContext,
          agreedType
        );
        
        if (haikuConfirmed) {
          this.stats.tier2_haikuVerified++;
          console.log(`      ✅ TIER 2 (Haiku confirmed): ${agreedType}`);
          
          // Learn this label for Tier 1 next time
          if (!isGenericLabel(field.label)) {
            this.cache.learnPattern(field, agreedType, 'haiku_confirmed');
            this.stats.patternsLearned++;
          }
          
          return { field_type: agreedType, confidence: maxConf, source: 'tier2_deberta_bge_haiku' };
        } else {
          this.stats.tier2_haikuRejected++;
          console.log(`      ⚠️ TIER 2: Haiku REJECTED DeBERTa+BGE agreement — falling to Tier 3`);
        }
      } else {
        if (debertaResult) console.log(`      🧠 DeBERTa: ${debertaResult.fieldType} (${(debertaResult.confidence * 100).toFixed(0)}%)`);
        if (bgeResult) console.log(`      🧠 BGE: ${bgeResult.fieldType} (${(bgeResult.confidence * 100).toFixed(0)}%)`);
        if (!debertaResult && !bgeResult) console.log(`      ⬇️ Tier 2: no AI signals above threshold`);
        else console.log(`      ⬇️ Tier 2: AI signals disagree or too low confidence`);
      }
    }
    
    // ─── 2C: Unverified cache hit → Haiku confirms ───
    if (!generic) {
      const cached = this.cache.checkLearnedPatterns(field);
      if (cached && !cached.verified) {
        console.log(`      🔍 TIER 2: Unverified cache: ${cached.field_type} (${(cached.confidence * 100).toFixed(0)}%)`);
        
        const haikuConfirmed = await this._haikuConfirmLabel(
          field.label || field.id || '',
          cached.field_type
        );
        
        if (haikuConfirmed) {
          this.stats.tier2_haikuVerified++;
          console.log(`      ✅ TIER 2 (Haiku confirmed unverified cache): ${cached.field_type}`);
          return { field_type: cached.field_type, confidence: 0.92, source: 'tier2_cache_haiku' };
        } else {
          this.stats.tier2_haikuRejected++;
          console.log(`      ⚠️ TIER 2: Haiku REJECTED unverified cache — falling to Tier 3`);
        }
      }
    }
    
    console.log(`      ⬇️ Tier 2: no confirmed match`);
    return null;
  }
  
  // ============================================================================
  // HAIKU VERIFICATION CALLS (~$0.001 each)
  // ============================================================================
  
  async _haikuConfirmQuestion(actualQuestion, proposedType, matchedQuestion) {
    if (!this.client) return false;
    
    this.stats.tier2_haikuCalls++;
    
    // Build a human-readable description of the proposed type
    const typeDescription = this._getFieldTypeDescription(proposedType);
    
    const prompt = `Question on a job application form:
"${actualQuestion.substring(0, 400)}"

Our system thinks this is asking about: ${typeDescription} (field_type: ${proposedType})
Matched to known question: "${matchedQuestion.substring(0, 200)}"

Is our classification correct? Consider subtle differences carefully.
For example, "authorized to work" vs "authorized to work on an INDEFINITE basis" are DIFFERENT.

Reply with ONLY "yes" or "no".`;
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.haikuModel,
        max_tokens: CONFIG.haikuMaxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      return text === 'yes';
    } catch (error) {
      console.warn(`      ⚠️ Haiku verification error: ${error.message}`);
      return false;  // On error, don't trust — fall to Tier 3
    }
  }
  
  async _haikuConfirmLabel(label, proposedType) {
    if (!this.client) return false;
    
    this.stats.tier2_haikuCalls++;
    
    const typeDescription = this._getFieldTypeDescription(proposedType);
    
    const prompt = `A job application form field has the label: "${(label || '').substring(0, 300)}"

Our system classified this as: ${typeDescription} (field_type: ${proposedType})

Is this classification correct?
Reply with ONLY "yes" or "no".`;
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.haikuModel,
        max_tokens: CONFIG.haikuMaxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      return text === 'yes';
    } catch (error) {
      console.warn(`      ⚠️ Haiku verification error: ${error.message}`);
      return false;
    }
  }
  
  _getFieldTypeDescription(fieldType) {
    const descriptions = {
      'work_authorization': 'whether authorized to work (Yes/No)',
      'work_authorization_indefinite': 'whether authorized to work on an INDEFINITE basis',
      'visa_sponsorship': 'whether visa sponsorship is needed',
      'citizenship_status': 'whether US citizen or permanent resident',
      'citizenship_country_text': 'country of citizenship (text)',
      'restricted_country_citizen': 'citizen of a restricted country',
      'group_d_country_citizen': 'citizen of a Group D country',
      'foreign_permanent_resident': 'permanent resident of another country',
      'current_visa_status': 'current visa/immigration status',
      'j1_j2_visa_history': 'J-1 or J-2 visa history',
      'previously_employed': 'previously employed at this company',
      'relative_at_company': 'relative working at this company',
      'other_commitments': 'other commitments or conflicts',
      'restrictive_agreement': 'non-compete or restrictive agreement',
      'age_verification': 'age verification (18+)',
      'terms_agreement': 'agreement to terms and conditions',
      'ai_recruitment_consent': 'consent to AI in recruitment',
      'future_opportunities_consent': 'consent for future job opportunities',
      'hispanic_latino': 'Hispanic or Latino identity',
      'first_name': 'first name',
      'last_name': 'last name',
      'email': 'email address',
      'phone_number': 'phone number',
      'gender': 'gender',
      'race_ethnicity': 'race or ethnicity',
      'veteran_status': 'veteran status',
      'disability_status': 'disability status',
      'referral_source': 'how applicant heard about the job',
    };
    return descriptions[fieldType] || fieldType;
  }
  
  // ============================================================================
  // TIER 3: OPUS FULL CLASSIFICATION (~$0.015)
  // ============================================================================
  async _tier3OpusFull(field, generic) {
    if (!this.client) {
      console.warn('      ⚠️ No API client configured');
      return null;
    }
    
    this.stats.tier3_opus++;
    
    const sectionText = field.section || field.fullText || '';
    const questionText = this.extractQuestionText(field);
    
    let prompt;
    
    if (generic && sectionText.length > 20) {
      // QUESTIONNAIRE MODE
      const sectionParts = sectionText.split(' | ').filter(s => s.trim().length > 10);
      const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
      const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
      const fieldPosition = genericIndex >= 0 ? genericIndex + 1 : this.currentFieldIndex;
      
      const questionList = sectionParts
        .map((q, i) => `  Q${i + 1}: "${q.substring(0, 300)}"`)
        .join('\n');
      
      prompt = `You are classifying dropdown fields on a job application questionnaire page.

THIS PAGE HAS ${genericFieldsOnPage.length} DROPDOWN FIELDS, all labeled "${field.label}".
Each dropdown corresponds to a question on the page.

THIS IS DROPDOWN #${fieldPosition} of ${genericFieldsOnPage.length}.

THE PAGE SECTION TEXT (questions in order):
${questionList}

FIELD DETAILS:
- Field ID: "${field.id || 'N/A'}"
- Field Type: ${field.type || 'dropdown'}
- Options: ${field.options ? JSON.stringify(field.options.slice(0, 10)) : 'N/A'}

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

KEY DISTINCTIONS:
- military_service = Armed Forces/military service (not veteran status)
- scp_referral = Referral from Senior Commercial Person (not how you heard about job)
- referral_source = How you heard about job (LinkedIn/website/etc.)
- veteran_status = EEO veteran reporting
- age_verification = Are you 18+?
- kpmg_employment/big_four_employment = Specific company employment history
- previously_employed = Worked at THIS company before
- sponsorship_details = Text explanation of visa needs
- visa_sponsorship = Yes/No sponsorship question

Match dropdown #${fieldPosition} to its corresponding question, then respond with ONLY the field_type (one of the above), nothing else.`;
    } else if (questionText) {
      // FOCUSED QUESTION MODE
      prompt = `Classify this job application question into a field type.

QUESTION: "${questionText}"

FIELD ID: "${field.id || 'N/A'}"
OPTIONS: ${field.options ? JSON.stringify(field.options.slice(0, 5)) : 'Yes/No'}

VALID FIELD TYPES (with descriptions for commonly confused types):
${FIELD_TYPES.join(', ')}

IMPORTANT DISTINCTIONS:
- military_service = "Are you serving/served in Armed Forces/military?" (Yes/No)
- veteran_status = "Are you a veteran?" for EEO reporting (Yes/No/Decline)
- age_verification = "Are you 18 or older?" age confirmation (Yes/No)

- scp_referral = "Are you a referral from a Senior Commercial Person/business leader?" (Yes/No)
- referral_source = "How did you hear about us?" (LinkedIn/Job Board/Website/etc.)

- kpmg_employment = "Did you work at KPMG?" specifically (Yes/No)
- big_four_employment = "Did you work at Big Four?" (Deloitte/PwC/EY/KPMG) (Yes/No)
- previously_employed = "Did you work at THIS company before?" (Yes/No)

- sponsorship_details = Text explanation of visa needs (H1B details, timeline, etc.)
- visa_sponsorship = "Do you need sponsorship?" Yes/No question

- healthcare_exclusion = "Excluded from Medicare/Medicaid?" (Yes/No)
- disciplinary_action = "Disciplinary action on license?" (Yes/No)

- explanation_text = Conditional "If yes, please explain" text field

Respond with ONLY the field_type, nothing else.`;
    } else {
      // STANDARD LABEL MODE
      prompt = `Classify this job application form field.

FIELD INFORMATION:
- Label: "${field.label || 'N/A'}"
- ID: "${field.id || 'N/A'}"
- Type: "${field.type || 'N/A'}"
- Options: ${field.options ? JSON.stringify(field.options.slice(0, 10)) : 'N/A'}
- Section/Context: "${sectionText.substring(0, 500)}"

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

COMMON CONFUSIONS TO AVOID:
- military_service (Armed Forces service) vs veteran_status (EEO reporting) vs age_verification (18+)
- scp_referral (referred by business leader) vs referral_source (how you heard about job)
- kpmg_employment (worked at KPMG) vs previously_employed (worked at THIS company)
- sponsorship_details (text explanation) vs visa_sponsorship (Yes/No)

Respond with ONLY the field_type (one of the above), nothing else.`;
    }
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.opusModel,
        max_tokens: CONFIG.opusMaxTokens,
        temperature: CONFIG.temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      
      if (text && FIELD_TYPES.includes(text)) {
        console.log(`      🔄 TIER 3 Opus says: ${text}`);
        
        // LEARN FOR NEXT TIME
        // 1. Add to exact cache (Tier 1 next time)
        if (questionText) {
          if (CONFIG.reviewMode) {
            this.addToReviewQueue({
              store: 'question_bank',
              field_type: text,
              label: field.label || '',
              question: questionText,
              answer: '',
              source: 'opus_classification',
              fieldId: field.id || '',
            });
          } else {
            this.addToExactCache(questionText, text, 'opus');
            await this.learnQuestionToBank(questionText, text);
          }
        }
        
        // 2. Learn label pattern
        if (!isGenericLabel(field.label)) {
          const validation = this.validateBeforeLearning(field, text);
          if (validation.valid) {
            if (CONFIG.reviewMode) {
              this.addToReviewQueue({
                store: 'cache',
                field_type: text,
                label: field.label || '',
                question: '',
                answer: '',
                source: 'opus_classification',
                fieldId: field.id || '',
                section: field.section || '',
              });
            } else {
              this.cache.learnPattern(field, text, 'opus_api');
            }
            this.stats.patternsLearned++;
          } else {
            console.log(`      ⚠️ VALIDATION WARNING: ${validation.reason}`);
            this.cache.learnPattern(field, text, 'opus_api_flagged');
            this.stats.patternsLearned++;
          }
        }
        
        return { field_type: text, confidence: 0.95, source: 'tier3_opus' };
      }
      
      // ============================================================================
      // INTELLIGENT FALLBACK: If Opus can't find a matching field_type,
      // let it analyze the question with the profile and determine the answer directly
      // ============================================================================
      if (text && !FIELD_TYPES.includes(text)) {
        console.log(`      ⚠️ Opus returned "${text}" which is not in FIELD_TYPES`);
        console.log(`      🧠 Activating intelligent fallback - Opus will analyze and answer directly...`);
        
        // Build a comprehensive profile summary for Opus to reason with
        const profileSummary = this.buildProfileSummary();
        
        const intelligentPrompt = `You are helping fill out a job application form. A question was asked that doesn't fit our standard field types.

QUESTION: "${questionText || field.label}"

FIELD DETAILS:
- Options: ${field.options ? JSON.stringify(field.options.slice(0, 10)) : 'Yes/No or text input'}
- Context: "${sectionText.substring(0, 300)}"

APPLICANT PROFILE:
${profileSummary}

TASK: Analyze this question and determine the correct answer based on the profile.

RULES:
1. If it's a Yes/No question, respond with ONLY "Yes" or "No"
2. If it's asking about employment status with this company, assume "No" (applicants rarely work at the company they're applying to)
3. If it's asking about relatives at the company, use the profile data
4. Use your reasoning to give the most accurate answer

Respond with ONLY the answer, nothing else.`;

        try {
          const intelligentResponse = await this.client.messages.create({
            model: CONFIG.opusModel,
            max_tokens: 100,
            temperature: CONFIG.temperature,
            messages: [{ role: 'user', content: intelligentPrompt }],
          });
          
          const answer = intelligentResponse.content[0]?.text?.trim();
          
          if (answer) {
            console.log(`      🎯 Opus intelligent answer: "${answer}"`);
            
            // Return as a special "direct answer" type
            return { 
              field_type: 'opus_direct_answer', 
              direct_answer: answer,
              confidence: 0.90, 
              source: 'tier3_opus_intelligent' 
            };
          }
        } catch (error) {
          console.warn(`      ⚠️ Opus intelligent fallback error: ${error.message}`);
        }
      }
    } catch (error) {
      console.warn(`      ⚠️ Opus API error: ${error.message}`);
    }
    
    return null;
  }
  
  // ============================================================================
  // BUILD PROFILE SUMMARY (for Opus intelligent reasoning)
  // ============================================================================
  buildProfileSummary() {
    const p = this.profile;
    if (!p) return 'No profile available';
    
    const summary = [];
    
    // Personal
    if (p.personal) {
      summary.push(`Name: ${p.personal.firstName} ${p.personal.lastName}`);
      if (p.personal.email) summary.push(`Email: ${p.personal.email}`);
      if (p.personal.phone) summary.push(`Phone: ${p.personal.phone}`);
    }
    
    // Work Authorization
    if (p.workAuth) {
      summary.push(`Authorized to work: ${p.workAuth.authorizedToWork ? 'Yes' : 'No'}`);
      if (p.workAuth.requiresSponsorship !== undefined) {
        summary.push(`Requires visa sponsorship: ${p.workAuth.requiresSponsorship ? 'Yes' : 'No'}`);
      }
    }
    
    // Employment
    if (p.employment) {
      if (p.employment.yearsOfExperience) {
        summary.push(`Years of experience: ${p.employment.yearsOfExperience}`);
      }
    }
    
    if (p.additional) {
      if (p.additional.previouslyEmployed !== undefined) {
        summary.push(`Previously employed at this company: ${p.additional.previouslyEmployed ? 'Yes' : 'No'}`);
      }
      if (p.additional.hasRelativeAtCompany !== undefined) {
        summary.push(`Has relative at company: ${p.additional.hasRelativeAtCompany ? 'Yes' : 'No'}`);
      }
      if (p.additional.currentlyEmployed !== undefined) {
        summary.push(`Currently employed (in general): ${p.additional.currentlyEmployed ? 'Yes' : 'No'}`);
      }
    }
    
    // Education
    if (p.education) {
      if (p.education.degree) summary.push(`Degree: ${p.education.degree}`);
      if (p.education.school) summary.push(`School: ${p.education.school}`);
    }
    
    // EEO
    if (p.eeo) {
      if (p.eeo.veteranStatus) summary.push(`Veteran status: ${p.eeo.veteranStatus}`);
      if (p.eeo.disabilityStatus) summary.push(`Disability status: ${p.eeo.disabilityStatus}`);
    }
    
    return summary.join('\n');
  }
  
  // ============================================================================
  // GET ANSWER FROM PROFILE (same as v7)
  // ============================================================================
  getAnswerFromProfile(fieldType, field = {}) {
    const p = this.profile;
    if (!p) return null;
    
    // PERSONAL
    if (fieldType === 'first_name') return p.personal?.firstName;
    if (fieldType === 'last_name') return p.personal?.lastName;
    if (fieldType === 'middle_name') return p.personal?.middleName || '';
    if (fieldType === 'full_name') return `${p.personal?.firstName || ''} ${p.personal?.lastName || ''}`.trim();
    if (fieldType === 'preferred_name') return p.personal?.preferredName || '';
    if (fieldType === 'email') return p.personal?.email;
    
    // PHONE
    if (fieldType === 'phone_number') return (p.personal?.phone || '').replace(/\D/g, '');
    if (fieldType === 'country_phone_code') return p.personal?.countryPhoneCode || '+1';
    if (fieldType === 'phone_extension') return '';
    if (fieldType === 'phone_type') return p.personal?.phoneType || 'Mobile';
    
    // ADDRESS
    if (fieldType === 'address_line_1') return p.address?.line1;
    if (fieldType === 'address_line_2') return p.address?.line2 || '';
    if (fieldType === 'city') return p.address?.city;
    if (fieldType === 'state') return p.address?.state;
    if (fieldType === 'postal_code') return p.address?.zipCode;
    if (fieldType === 'country') return p.address?.country || 'United States of America';
    
    // WORK AUTHORIZATION
    if (fieldType === 'work_authorization') return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    if (fieldType === 'work_authorization_indefinite') return p.workAuth?.isUSCitizenOrPR ? 'Yes' : 'No';
    if (fieldType === 'visa_sponsorship') return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    if (fieldType === 'citizenship_status') return p.workAuth?.isUSCitizenOrPR ? 'Yes' : 'No';
    if (fieldType === 'citizenship_country_text') return p.personal?.citizenship || 'India';
    if (fieldType === 'restricted_country_citizen') return p.additional?.isRestrictedCountryCitizen ? 'Yes' : 'No';
    if (fieldType === 'group_d_country_citizen') return p.additional?.isRestrictedCountryCitizen ? 'Yes' : 'No';
    if (fieldType === 'foreign_permanent_resident') return 'No';
    if (fieldType === 'current_visa_status') return p.workAuth?.visaStatus || 'H1B';
    if (fieldType === 'j1_j2_visa_history') return p.workAuth?.hadJ1J2Visa ? 'Yes' : 'No';
    
    // EMPLOYMENT
    if (fieldType === 'previously_employed') return p.additional?.previouslyEmployed ? 'Yes' : 'No';
    if (fieldType === 'current_employee') return 'No';  // Applicants are almost never current employees
    if (fieldType === 'relative_at_company') return p.additional?.hasRelativeAtCompany ? 'Yes' : 'No';
    if (fieldType === 'other_commitments') return p.additional?.hasOtherCommitments ? 'Yes' : 'No';
    if (fieldType === 'restrictive_agreement') return p.additional?.hasRestrictiveAgreement ? 'Yes' : 'No';
    if (fieldType === 'desired_salary') return p.employment?.desiredSalary || '';
    if (fieldType === 'available_start_date') return p.employment?.availableStartDate || '';
    if (fieldType === 'years_of_experience') return p.employment?.yearsOfExperience || '';
    
    // EDUCATION
    if (fieldType === 'school') return p.education?.school;
    if (fieldType === 'degree') return p.education?.degree;
    if (fieldType === 'field_of_study') return p.education?.fieldOfStudy;
    if (fieldType === 'graduation_year') return p.education?.graduationYear;
    if (fieldType === 'gpa') return p.education?.gpa || '';
    
    // DOCUMENTS
    if (fieldType === 'resume_upload') return p.documents?.resumePath;
    if (fieldType === 'cover_letter_upload') return p.documents?.coverLetterPath || '';
    if (fieldType === 'linkedin') return p.documents?.linkedin || '';
    if (fieldType === 'website') return p.documents?.website || '';
    if (fieldType === 'portfolio') return p.documents?.portfolio || '';
    
    // EEO
    if (fieldType === 'gender') return p.eeo?.gender;
    if (fieldType === 'race_ethnicity') return p.eeo?.race;
    if (fieldType === 'hispanic_latino') return p.eeo?.hispanicLatino || 'No';
    if (fieldType === 'veteran_status') return p.eeo?.veteranStatus;
    if (fieldType === 'disability_status') return p.eeo?.disabilityStatus;
    
    // CONSENT
    if (fieldType === 'terms_agreement') return 'Yes';
    if (fieldType === 'ai_recruitment_consent') return 'Yes';
    if (fieldType === 'future_opportunities_consent') return 'Yes';
    if (fieldType === 'age_verification') return p.additional?.over18 !== false ? 'Yes' : 'No';
    if (fieldType === 'minor_work_permit') return 'No';
    
    // REFERRAL
    if (fieldType === 'referral_source') return p.referral?.source || 'LinkedIn';
    
    // SIGNATURE / OTHER
    if (fieldType === 'signature_date') {
      const today = new Date();
      const fl = (field.label || '').toLowerCase();
      if (fl.includes('month') || fl === 'mm') return String(today.getMonth() + 1);
      if (fl.includes('day') || fl === 'dd') return String(today.getDate());
      if (fl.includes('year') || fl === 'yyyy') return String(today.getFullYear());
      return today.toLocaleDateString('en-US');
    }
    if (fieldType === 'employee_id') return '';
    if (fieldType === 'skills') return null;
    
    return null;
  }
  
  // ============================================================================
  // CLASSIFY MULTIPLE FIELDS
  // ============================================================================
  async classifyFields(fields) {
    const results = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      console.log(`   [${i + 1}/${fields.length}] 🧠 "${(field.label || field.id || '').substring(0, 60)}"...`);
      const result = await this.classifyField(field);
      results.push({ field, ...result });
    }
    return results;
  }
  
  // ============================================================================
  // PRINT STATISTICS
  // ============================================================================
  printStats() {
    const s = this.stats;
    const total = s.totalFields;
    
    const tier1Total = s.tier1_fieldId + s.tier1_exactCache + s.tier1_exactQuestion;
    const tier2Total = s.tier2_haikuVerified;
    const tier3Total = s.tier3_opus;
    
    const tier1Pct = total > 0 ? ((tier1Total / total) * 100).toFixed(1) : '0.0';
    const tier2Pct = total > 0 ? ((tier2Total / total) * 100).toFixed(1) : '0.0';
    const tier3Pct = total > 0 ? ((tier3Total / total) * 100).toFixed(1) : '0.0';
    
    // Cost estimation
    const haikuCost = s.tier2_haikuCalls * 0.001;
    const opusCost = s.tier3_opus * 0.015;
    const totalCost = haikuCost + opusCost;
    const fullOpusCost = total * 0.015;
    const saved = fullOpusCost - totalCost;
    
    console.log('\n' + '═'.repeat(65));
    console.log('📊 TRUST CASCADE v8 — STATISTICS');
    console.log('═'.repeat(65));
    console.log(`   Total Fields:              ${total}`);
    console.log('─'.repeat(65));
    console.log(`   ✅ TIER 1 (FREE):           ${tier1Total} (${tier1Pct}%)`);
    console.log(`      ├── Field ID regex:      ${s.tier1_fieldId}`);
    console.log(`      ├── Verified cache:      ${s.tier1_exactCache}`);
    console.log(`      └── Exact question:      ${s.tier1_exactQuestion}`);
    console.log(`   🔍 TIER 2 (Haiku ~$0.001):  ${tier2Total} confirmed (${tier2Pct}%)`);
    console.log(`      ├── Haiku calls:         ${s.tier2_haikuCalls}`);
    console.log(`      ├── Confirmed:           ${s.tier2_haikuVerified}`);
    console.log(`      └── Rejected:            ${s.tier2_haikuRejected}`);
    console.log(`   🌐 TIER 3 (Opus ~$0.015):   ${tier3Total} (${tier3Pct}%)`);
    console.log(`   ❌ Failed:                  ${s.failed}`);
    console.log('─'.repeat(65));
    console.log(`   💰 Est. Cost This Page:     $${totalCost.toFixed(4)}`);
    console.log(`      ├── Haiku:               $${haikuCost.toFixed(4)} (${s.tier2_haikuCalls} calls)`);
    console.log(`      ├── Opus:                $${opusCost.toFixed(4)} (${s.tier3_opus} calls)`);
    console.log(`      └── Saved vs all-Opus:   $${saved.toFixed(4)}`);
    console.log('─'.repeat(65));
    console.log(`   📝 Exact Cache Size:        ${Object.keys(this.exactCache).length}`);
    console.log(`   📖 Question Bank:           ${this.questionBank.length}`);
    console.log(`   📚 Patterns Learned:        ${s.patternsLearned}`);
    console.log(`   🔍 Pending Review:          ${s.pendingReview}`);
    console.log('═'.repeat(65) + '\n');
    
    this.cache.printStats();
    this.printReviewQueueSummary();
  }
  
  getLearnedPatternsCount() {
    return Object.keys(this.cache.learnedPatterns).length;
  }
}

export default VerifiedFieldClassifier;
export { VerifiedFieldClassifier, FIELD_TYPES };
