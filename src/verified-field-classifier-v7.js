/**
 * Verified Field Classifier v7 - AI-FIRST, CONSENSUS-BASED ARCHITECTURE
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                        THE v7 FLOW (EVERY FIELD)                          ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║   STEP 1: FIELD ID PATTERN MATCH (instant, free)                          ║
 * ║      "countryRegion" → state (95%)                                        ║
 * ║      Always runs. Result stored.                                          ║
 * ║                                                                           ║
 * ║   STEP 1b: CACHE LOOKUP (learned patterns from Claude)                    ║
 * ║      "Select One" → age_verification (95%) [✓ verified]                   ║
 * ║      Always runs. Result stored. Gets stronger with every application!    ║
 * ║                                                                           ║
 * ║   STEP 2: AI CLASSIFICATION (DeBERTa + BGE)                              ║
 * ║      Zero-Shot: "relative_at_company" (87%)                               ║
 * ║      Semantic:  "relative_at_company" (91%)                               ║
 * ║      Always runs. Results stored.                                         ║
 * ║                                                                           ║
 * ║   STEP 3: CONSENSUS CHECK                                                ║
 * ║      Do Step 1 + Step 2 AGREE with confidence ≥ 85%?                     ║
 * ║      → YES → Go to Step 4                                                ║
 * ║      → NO  → Go to Step 5                                                ║
 * ║                                                                           ║
 * ║   STEP 4: GET ANSWER FROM CACHE/PROFILE                                  ║
 * ║      Cache key: field_type + exact question                               ║
 * ║      Get answer from profile → Done ✅                                    ║
 * ║                                                                           ║
 * ║   STEP 5: CLAUDE OPUS 4.5 FALLBACK                                       ║
 * ║      Claude classifies + answers                                          ║
 * ║      Record pattern (unverified, for daily review)                        ║
 * ║      Learn for next time → Done ✅                                        ║
 * ║                                                                           ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║   KEY PRINCIPLE: NO EARLY RETURNS. All signals run, then consensus.       ║
 * ║   Cache does NOT classify. Cache only stores Claude learnings.            ║
 * ║   AI is the brain. Claude is the safety net. Cache gets smarter daily.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
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
  // Standard classification (Field ID + DeBERTa + BGE consensus)
  model: 'claude-opus-4-5-20251101',
  maxTokens: 500,
  temperature: 0,
  verbose: true,
  confidenceThreshold: 0.85,  // Consensus must be ≥ 85% to skip Claude
  
  // Questionnaire mode (generic labels like "Select One")
  // Uses BGE question bank matching (FREE) → Claude Opus fallback
  // During testing: Opus builds highest-quality question bank
  // After testing: Switch to Haiku for cost savings
  questionnaireModel: 'claude-opus-4-5-20251101',
  questionnaireMaxTokens: 50,                         // Only need 1-2 words back
  questionnaireThreshold: 0.82,                       // BGE match threshold for questions
  questionBankPath: null,                             // Set in constructor
  
  // Review mode: ALL learned patterns require manual approval
  reviewMode: true,
  reviewQueuePath: null,                              // Set in constructor
};

// ============================================================================
// ALL KNOWN FIELD TYPES
// ============================================================================
const FIELD_TYPES = [
  // Personal
  'first_name', 'last_name', 'middle_name', 'full_name', 'preferred_name',
  'email', 'phone_number', 'country_phone_code', 'phone_extension', 'phone_type',
  
  // Address
  'address_line_1', 'address_line_2', 'city', 'state', 'postal_code', 'country',
  
  // Work Authorization
  'work_authorization', 'work_authorization_indefinite', 'visa_sponsorship',
  'citizenship_status', 'citizenship_country_text', 'restricted_country_citizen', 
  'group_d_country_citizen', 'foreign_permanent_resident',
  'current_visa_status', 'j1_j2_visa_history',
  
  // Employment
  'previously_employed', 'desired_salary', 'available_start_date',
  'years_of_experience', 'relative_at_company', 'other_commitments',
  'restrictive_agreement',
  
  // Education
  'school', 'degree', 'field_of_study', 'graduation_year', 'gpa',
  
  // Documents
  'resume_upload', 'cover_letter_upload', 'linkedin', 'website', 'portfolio',
  
  // EEO
  'gender', 'race_ethnicity', 'veteran_status', 'disability_status', 'hispanic_latino',
  
  // Consent
  'terms_agreement', 'ai_recruitment_consent', 'future_opportunities_consent',
  'age_verification', 'minor_work_permit',
  
  // Other
  'referral_source', 'signature_date', 'employee_id', 'skills',
];

// ============================================================================
// YES/NO FIELD TYPES: These return "Yes" or "No" from profile.
// If a TEXTAREA is classified as one of these, it's almost certainly wrong —
// textareas expect free-text answers, not Yes/No. This catches conditional
// follow-up fields where Workday shows a textarea after a dropdown answer
// but the DOM scraper captures the parent question label.
// ============================================================================
const YES_NO_FIELD_TYPES = new Set([
  'work_authorization', 'work_authorization_indefinite', 'visa_sponsorship',
  'citizenship_status', 'restricted_country_citizen', 'group_d_country_citizen',
  'foreign_permanent_resident', 'j1_j2_visa_history',
  'previously_employed', 'relative_at_company', 'other_commitments',
  'restrictive_agreement', 'age_verification', 'terms_agreement',
  'ai_recruitment_consent', 'future_opportunities_consent', 'hispanic_latino',
]);

// ============================================================================
// FIELD ID PATTERNS (instant pattern matching on field IDs)
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
// ZERO-SHOT LABEL → FIELD_TYPE MAPPING
// Maps DeBERTa's natural language labels to our field_type identifiers
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
// GENERIC LABELS (too ambiguous to cache or use for AI classification)
// These appear on many different question types across applications
// ============================================================================
const GENERIC_LABELS = new Set([
  'select one', 'select', 'choose one', 'choose', 'yes', 'no',
  'please select', 'select option', '',
]);

function isGenericLabel(label) {
  return GENERIC_LABELS.has((label || '').toLowerCase().replace(/[*:\s]+/g, ' ').trim());
}

// ============================================================================
// VERIFIED FIELD CLASSIFIER v7
// ============================================================================
class VerifiedFieldClassifier {
  constructor(options = {}) {
    this.profile = options.profile || null;
    this.stage1Classifier = options.stage1Classifier || null;  // DeBERTa Zero-Shot
    this.stage2Classifier = options.stage2Classifier || null;  // BGE Semantic
    
    // Claude fallback
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
    
    // Cache: ONLY stores Claude's learnings (not for classification!)
    this.cache = new HierarchicalCache({
      cacheDir: options.cacheDir || './cache',
    });
    
    // Context
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Page context: all fields on current page (for Claude batch awareness)
    this.pageFields = [];
    this.currentFieldIndex = 0;
    
    // ══════════════════════════════════════════════════════
    // QUESTIONNAIRE BANK: BGE-matched question → field_type
    // Grows from Claude classifications, eventually
    // handles most questions locally for FREE
    // ══════════════════════════════════════════════════════
    CONFIG.questionBankPath = options.questionBankPath || 
      path.join(options.cacheDir || './cache', 'questionnaire-bank.json');
    this.questionBank = [];           // Array of { text, field_type, source }
    this.questionBankEmbeddings = []; // Parallel array of pre-computed BGE embeddings
    this.questionBankReady = false;   // Set true after embeddings computed
    this.loadQuestionBank();
    
    // ══════════════════════════════════════════════════════
    // REVIEW QUEUE: All learned patterns go here FIRST
    // Nothing gets permanently saved without manual approval
    // ══════════════════════════════════════════════════════
    CONFIG.reviewQueuePath = options.reviewQueuePath ||
      path.join(options.cacheDir || './cache', 'review-queue.json');
    this.reviewQueue = [];            // Array of { type, field_type, label, question, answer, source, timestamp, status }
    this.loadReviewQueue();
    
    // Statistics
    this.stats = {
      totalFields: 0,
      fromConsensus: 0,
      fromClaude: 0,
      claudeDirect: 0,       // Generic labels → straight to Claude (skipped DeBERTa/BGE)
      fromQuestionBank: 0,   // Questionnaire matched by BGE against known questions (FREE)
      patternsLearned: 0,
      pendingReview: 0,       // Patterns waiting for manual approval
      cacheHits: 0,         // Times cache contributed a vote
      cacheDecisive: 0,     // Times cache made the difference for consensus
      consensusDetails: {
        allAgree: 0,       // All signals unanimous
        majorityAgree: 0,  // Majority agrees
      },
      aiConfidences: {
        deberta: [],
        bge: [],
      },
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
      console.log('🎯 APPLICATION CONTEXT SET');
      console.log('═'.repeat(60));
      console.log(`   URL: ${url ? url.substring(0, 60) + '...' : '(none)'}`);
      console.log(`   ATS Platform: ${this.currentATS}`);
      console.log(`   Company: ${this.currentCompany}`);
      console.log('═'.repeat(60) + '\n');
    }
  }
  
  setProfile(profile) {
    this.profile = profile;
  }
  
  // ============================================================================
  // TEXTAREA GUARD: Detect when a Yes/No classification hits a textarea
  // 
  // Conditional follow-up fields in Workday:
  //   1. User answers "No" to a dropdown question
  //   2. Workday reveals a textarea: "Please provide your current status"
  //   3. DOM scraper captures the PARENT dropdown question as the textarea's label
  //   4. DeBERTa sees "Are you authorized to work..." → work_authorization (91%)
  //   5. Profile returns "Yes" → typed into textarea → WRONG
  //
  // Guard: If field.type === 'textarea' and classified type is a Yes/No type,
  // the classification is almost certainly wrong. Reclassify with Claude.
  // If Claude also fails, use keyword heuristics. If all fails, BLOCK the fill.
  // ============================================================================
  async textareaGuard(field, classifiedType, classifiedConfidence, classifiedSource) {
    // Only applies to textareas classified as Yes/No field types
    if (field.type !== 'textarea' || !YES_NO_FIELD_TYPES.has(classifiedType)) {
      return null;
    }
    
    console.log(`      ⚠️ TEXTAREA GUARD: "${classifiedType}" is a Yes/No type but field is textarea`);
    console.log(`         This is likely a follow-up text field, not a Yes/No question`);
    console.log(`         Re-classifying with Claude...`);
    
    // Ask Claude specifically about this textarea
    if (!this.client) {
      console.log(`      ⚠️ No API client — using keyword heuristics`);
      return this._textareaKeywordFallback(field, classifiedType);
    }
    
    const label = field.label || field.name || field.id || '';
    const sectionText = field.section || field.fullText || '';
    
    // Detect *Yes/*No suffix — telltale of Workday follow-up pattern
    const previousAnswer = label.match(/\*\s*(Yes|No)\s*$/i)?.[1] || '';
    const previousAnswerHint = previousAnswer 
      ? `\nIMPORTANT: The label ends with "*${previousAnswer}" — this means the applicant already answered "${previousAnswer}" to a PREVIOUS dropdown. This textarea is a FOLLOW-UP asking for additional details (like a country name, visa type, or explanation).`
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
        model: CONFIG.questionnaireModel,  // Opus during testing
        max_tokens: 50,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      
      if (text && FIELD_TYPES.includes(text) && !YES_NO_FIELD_TYPES.has(text)) {
        console.log(`      🔄 Textarea guard: ${classifiedType} → ${text}`);
        this.stats.fromClaude++;
        return {
          field_type: text,
          confidence: 0.90,
          source: 'textarea_guard',
        };
      }
      
      // Reclassification returned same Yes/No type or invalid — try keyword fallback
      console.log(`      ⚠️ Guard reclassification returned "${text}" (still Yes/No or invalid)`);
    } catch (error) {
      console.warn(`      ⚠️ Textarea guard API error: ${error.message}`);
    }
    
    // KEYWORD FALLBACK: Better than returning wrong Yes/No answer
    return this._textareaKeywordFallback(field, classifiedType);
  }
  
  // ============================================================================
  // TEXTAREA KEYWORD FALLBACK
  // When guard's reclassification call fails, use keyword heuristics to guess the text type.
  // Even if we guess wrong, BLOCKING is better than "Yes" in a textarea.
  // ============================================================================
  _textareaKeywordFallback(field, classifiedType) {
    const label = (field.label || field.section || '').toLowerCase();
    
    // Citizenship-related textarea → asking for country name
    if (label.includes('citizen') || label.includes('citizenship') || label.includes('country')) {
      console.log(`      🔄 Textarea keyword fallback: ${classifiedType} → citizenship_country_text (keyword: citizen/country)`);
      return { field_type: 'citizenship_country_text', confidence: 0.80, source: 'textarea_guard_keyword' };
    }
    
    // Work auth / visa-related textarea → asking for visa status
    if (label.includes('authorized to work') || label.includes('visa') || label.includes('status') || label.includes('immigration')) {
      console.log(`      🔄 Textarea keyword fallback: ${classifiedType} → current_visa_status (keyword: visa/status)`);
      return { field_type: 'current_visa_status', confidence: 0.80, source: 'textarea_guard_keyword' };
    }
    
    // Generic textarea with no clear keywords — BLOCK rather than fill wrong
    console.log(`      🚫 Textarea guard: BLOCKED "${classifiedType}" (Yes/No on textarea). No keyword match.`);
    console.log(`         Returning skills type as safe free-text default`);
    return { field_type: 'skills', confidence: 0.50, source: 'textarea_guard_blocked' };
  }
  
  // ============================================================================
  // LAYER 3: VALIDATE BEFORE LEARNING
  // 
  // Catches potential misclassifications BEFORE they get saved to cache.
  // Prevents poisoning the learned patterns with wrong field types.
  // ============================================================================
  validateBeforeLearning(field, fieldType) {
    // CHECK 1: Yes/No type on a textarea → almost always wrong
    if (field.type === 'textarea' && YES_NO_FIELD_TYPES.has(fieldType)) {
      return {
        valid: false,
        reason: `Yes/No type "${fieldType}" on textarea — likely a follow-up text field`,
      };
    }
    
    // CHECK 2: Text-only type on a dropdown → type mismatch
    const TEXT_ONLY_TYPES = new Set([
      'citizenship_country_text', 'current_visa_status', 'skills',
      'first_name', 'last_name', 'middle_name', 'full_name', 'preferred_name',
      'email', 'phone_number', 'address_line_1', 'address_line_2',
      'city', 'postal_code',
    ]);
    
    if (field.type === 'dropdown' && TEXT_ONLY_TYPES.has(fieldType)) {
      return {
        valid: false,
        reason: `Text type "${fieldType}" on dropdown — type mismatch`,
      };
    }
    
    // CHECK 3: Question text keyword mismatch detection
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
        return {
          valid: false,
          reason: `Question has "${matchedKeyword}" but classified as "${fieldType}" instead of "${check.expected}"`,
        };
      }
    }
    
    // All checks passed
    return { valid: true };
  }
  
  // ============================================================================
  // SET PAGE FIELDS (called before classification loop, gives batch context)
  // ============================================================================
  setPageFields(fields) {
    this.pageFields = fields || [];
    this.currentFieldIndex = 0;
  }
  
  // ============================================================================
  // QUESTIONNAIRE BANK: Load, match, learn, save
  // ============================================================================
  
  loadQuestionBank() {
    try {
      if (fs.existsSync(CONFIG.questionBankPath)) {
        const data = JSON.parse(fs.readFileSync(CONFIG.questionBankPath, 'utf-8'));
        this.questionBank = data.questions || [];
        console.log(`[QuestionBank] Loaded ${this.questionBank.length} known questions`);
      } else {
        // Try to find seed file in the source directory
        const seedPath = path.join(__dirname, 'questionnaire-bank.json');
        if (fs.existsSync(seedPath)) {
          const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
          this.questionBank = data.questions || [];
          // Copy seed to cache dir
          const cacheDir = path.dirname(CONFIG.questionBankPath);
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(CONFIG.questionBankPath, JSON.stringify(data, null, 2));
          console.log(`[QuestionBank] Initialized from seed: ${this.questionBank.length} questions`);
        } else {
          console.log(`[QuestionBank] No question bank found, starting empty`);
          this.questionBank = [];
        }
      }
    } catch (error) {
      console.warn(`[QuestionBank] Load error: ${error.message}`);
      this.questionBank = [];
    }
  }
  
  async precomputeQuestionBankEmbeddings() {
    if (this.questionBankReady || !this.stage2Classifier || this.questionBank.length === 0) {
      return;
    }
    
    // Ensure BGE model is loaded
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
        // Push null for failed embeddings
        this.questionBankEmbeddings.push(null);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[QuestionBank] ${this.questionBankEmbeddings.filter(e => e).length} embeddings ready (${elapsed}s)`);
    this.questionBankReady = true;
  }
  
  extractQuestionText(field) {
    // Extract the actual question that corresponds to this generic-label field
    const sectionText = field.section || field.fullText || '';
    if (!sectionText || sectionText.length < 20) return null;
    
    // Split section by ' | ' to get individual questions/parts  
    const sectionParts = sectionText.split(' | ').filter(s => s.trim().length > 15);
    if (sectionParts.length === 0) return null;
    
    // Find this field's position among generic-label fields on the page
    const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
    const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
    
    if (genericIndex >= 0 && genericIndex < sectionParts.length) {
      return sectionParts[genericIndex].substring(0, 500).trim();
    }
    
    // Fallback: return the longest section part (likely the question)
    const longest = sectionParts.reduce((a, b) => a.length > b.length ? a : b, '');
    return longest.substring(0, 500).trim();
  }
  
  async classifyQuestionnaire(field) {
    // Ensure embeddings are computed
    if (!this.questionBankReady) {
      await this.precomputeQuestionBankEmbeddings();
    }
    
    if (!this.stage2Classifier || !this.questionBankReady || this.questionBank.length === 0) {
      return null;
    }
    
    // Extract the actual question text
    const questionText = this.extractQuestionText(field);
    if (!questionText || questionText.length < 15) return null;
    
    try {
      // Get BGE embedding for this question
      const questionEmbedding = await this.stage2Classifier.getEmbedding(questionText);
      
      // Compare against all question bank embeddings
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
      
      if (bestMatch && bestScore >= CONFIG.questionnaireThreshold) {
        return {
          fieldType: bestMatch.field_type,
          confidence: bestScore,
          matchedQuestion: bestMatch.text.substring(0, 80),
          source: bestMatch.source,
        };
      }
      
      return null;
    } catch (error) {
      console.warn(`      ⚠️ Question bank match error: ${error.message}`);
      return null;
    }
  }
  
  async learnQuestionnairePattern(questionText, fieldType) {
    if (!questionText || !fieldType || questionText.length < 15) return;
    
    // Check if already in bank (avoid duplicates with high similarity)
    if (this.questionBankReady && this.stage2Classifier) {
      try {
        const newEmb = await this.stage2Classifier.getEmbedding(questionText);
        
        for (let i = 0; i < this.questionBankEmbeddings.length; i++) {
          const existing = this.questionBankEmbeddings[i];
          if (!existing) continue;
          const sim = this.stage2Classifier.cosineSimilarity(newEmb, existing);
          if (sim > 0.95 && this.questionBank[i].field_type === fieldType) {
            // Already have a very similar question for same type
            return;
          }
        }
        
        // Add to bank
        const entry = { text: questionText, field_type: fieldType, source: 'learned' };
        this.questionBank.push(entry);
        this.questionBankEmbeddings.push(newEmb);
        
        console.log(`   📚 LEARNED QUESTION: "${questionText.substring(0, 60)}..." → ${fieldType}`);
        
        // Persist
        this.saveQuestionBank();
      } catch (error) {
        console.warn(`[QuestionBank] Learn error: ${error.message}`);
      }
    }
  }
  
  saveQuestionBank() {
    try {
      const cacheDir = path.dirname(CONFIG.questionBankPath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      
      const data = {
        version: 1,
        updated: new Date().toISOString(),
        questions: this.questionBank,
      };
      
      fs.writeFileSync(CONFIG.questionBankPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[QuestionBank] Save error: ${error.message}`);
    }
  }
  
  // ============================================================================
  // REVIEW QUEUE: All learned patterns go here for manual approval
  //
  // Flow:
  //   1. Claude classifies a field → pattern goes to review queue (status: "pending")
  //   2. Pattern works DURING THIS SESSION (runtime use)
  //   3. At end of run, review queue is printed + saved to review-queue.json
  //   4. User reviews: changes status to "approved" or "rejected"
  //   5. Next run: approved items → permanent cache/question bank
  //                rejected items → deleted
  //                pending items → still pending (used at runtime only)
  // ============================================================================
  
  loadReviewQueue() {
    try {
      if (fs.existsSync(CONFIG.reviewQueuePath)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG.reviewQueuePath, 'utf-8'));
        this.reviewQueue = raw.items || [];
        
        // Process approved items → move to permanent storage
        const approved = this.reviewQueue.filter(item => item.status === 'approved');
        const rejected = this.reviewQueue.filter(item => item.status === 'rejected');
        const pending = this.reviewQueue.filter(item => item.status === 'pending');
        
        if (approved.length > 0) {
          console.log(`[ReviewQueue] Processing ${approved.length} approved pattern(s)...`);
          for (const item of approved) {
            if (item.store === 'question_bank') {
              // Add to permanent question bank
              const exists = this.questionBank.some(q => 
                q.text === item.question && q.field_type === item.field_type
              );
              if (!exists) {
                this.questionBank.push({ 
                  text: item.question, 
                  field_type: item.field_type, 
                  source: 'approved' 
                });
                console.log(`   ✅ → Question Bank: "${item.question.substring(0, 50)}..." → ${item.field_type}`);
              }
            } else if (item.store === 'cache') {
              // Add to permanent cache
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
        
        // Keep only pending items (approved/rejected are processed)
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
    // Check for duplicates
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
        instructions: "Review each item below. Change status to 'approved' or 'rejected'. Approved items get saved permanently on next run.",
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
  // STEP 1: FIELD ID PATTERN MATCH
  // ============================================================================
  classifyByFieldId(field) {
    const fieldId = field.id || field.name || '';
    if (!fieldId) return null;
    
    for (const { pattern, type } of FIELD_ID_PATTERNS) {
      if (pattern.test(fieldId)) {
        return { fieldType: type, confidence: 0.95 };
      }
    }
    return null;
  }
  
  // ============================================================================
  // STEP 1b: CACHE LOOKUP (learned patterns from previous Claude calls)
  // ============================================================================
  classifyFromCache(field) {
    // NEVER trust cache for generic labels like "Select One"
    // These are ambiguous - different questions share the same label
    if (isGenericLabel(field.label)) {
      return null;
    }
    
    const cached = this.cache.checkLearnedPatterns(field);
    if (cached) {
      return {
        fieldType: cached.field_type,
        confidence: cached.confidence,  // 0.95 if verified, 0.85 if unverified
        verified: cached.verified,
      };
    }
    return null;
  }
  
  // ============================================================================
  // STEP 2: AI CLASSIFICATION (DeBERTa + BGE - both always run)
  // ============================================================================
  async classifyWithAI(field) {
    const contextForAI = this.buildAIContext(field);
    const results = { zeroShot: null, semantic: null };
    
    // --- DeBERTa Zero-Shot ---
    if (this.stage1Classifier) {
      try {
        const zsResult = await this.stage1Classifier.classifyField(contextForAI, field.type);
        const fieldType = ZEROSHOT_LABEL_TO_FIELD_TYPE[zsResult.label] || null;
        
        if (fieldType) {
          results.zeroShot = {
            fieldType,
            confidence: zsResult.confidence,
            rawLabel: zsResult.label,
            topMatches: zsResult.allScores,
          };
          this.stats.aiConfidences.deberta.push(zsResult.confidence);
        }
      } catch (error) {
        console.warn(`      ⚠️ DeBERTa error: ${error.message}`);
      }
    }
    
    // --- BGE Semantic Similarity ---
    if (this.stage2Classifier) {
      try {
        const semResult = await this.stage2Classifier.classifyField(contextForAI);
        
        if (semResult && semResult.fieldType) {
          results.semantic = {
            fieldType: semResult.fieldType,
            confidence: semResult.similarity,
            topMatches: semResult.topMatches,
          };
          this.stats.aiConfidences.bge.push(semResult.similarity);
        }
      } catch (error) {
        console.warn(`      ⚠️ BGE error: ${error.message}`);
      }
    }
    
    return results;
  }
  
  // ============================================================================
  // BUILD AI CONTEXT (clean, per-field only)
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
    
    // ══════════════════════════════════════════════════════
    // QUESTION EXTRACTION: For generic labels, find the
    // specific question that corresponds to THIS field
    // ══════════════════════════════════════════════════════
    if (field.section) {
      if (generic && this.pageFields.length > 0) {
        // Split section into individual questions/parts
        const sectionParts = field.section.split(' | ').filter(s => s.trim().length > 15);
        
        // Find this field's position among generic-label fields
        const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
        const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
        
        if (genericIndex >= 0 && genericIndex < sectionParts.length) {
          // Found the matching question for this field's position
          const question = sectionParts[genericIndex].substring(0, 300);
          parts.push(`Question: ${question}`);
        } else {
          // Fallback: use all section parts (truncated)
          const allQuestions = sectionParts.map(s => s.substring(0, 200)).join(' | ');
          parts.push(`Context: ${allQuestions.substring(0, 400)}`);
        }
      } else {
        // Standard field: use first relevant section part
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
  // STEP 3: CONSENSUS CHECK
  // All signals vote. Check if they agree at ≥ 85%.
  // ============================================================================
  checkConsensus(fieldIdResult, aiResults, cacheResult) {
    const { zeroShot, semantic } = aiResults;
    
    // Collect all votes (up to 4: Field ID, DeBERTa, BGE, Cache)
    const votes = [];
    if (fieldIdResult) {
      votes.push({ source: 'field_id', fieldType: fieldIdResult.fieldType, confidence: fieldIdResult.confidence });
    }
    if (cacheResult) {
      votes.push({ source: 'cache', fieldType: cacheResult.fieldType, confidence: cacheResult.confidence });
    }
    if (zeroShot) {
      votes.push({ source: 'deberta', fieldType: zeroShot.fieldType, confidence: zeroShot.confidence });
    }
    if (semantic) {
      votes.push({ source: 'bge', fieldType: semantic.fieldType, confidence: semantic.confidence });
    }
    
    if (votes.length === 0) {
      return { agreed: false, fieldType: null, confidence: 0, source: 'no_signals', votes };
    }
    
    // Count votes per field type
    const voteCounts = {};
    for (const vote of votes) {
      if (!voteCounts[vote.fieldType]) {
        voteCounts[vote.fieldType] = { count: 0, maxConf: 0, sources: [] };
      }
      voteCounts[vote.fieldType].count++;
      voteCounts[vote.fieldType].maxConf = Math.max(voteCounts[vote.fieldType].maxConf, vote.confidence);
      voteCounts[vote.fieldType].sources.push(vote.source);
    }
    
    // Find winner
    let bestType = null;
    let bestData = { count: 0, maxConf: 0, sources: [] };
    for (const [fieldType, data] of Object.entries(voteCounts)) {
      if (data.count > bestData.count ||
          (data.count === bestData.count && data.maxConf > bestData.maxConf)) {
        bestType = fieldType;
        bestData = data;
      }
    }
    
    // Calculate effective confidence
    const total = votes.length;
    let effectiveConfidence;
    let consensusSource;
    
    if (bestData.count === total && total >= 2) {
      // ALL signals agree (2/2, 3/3, or 4/4)
      effectiveConfidence = bestData.maxConf;
      consensusSource = `all_${total}_agree`;
    } else if (bestData.count >= 2 && bestData.count > total / 2) {
      // MAJORITY agrees (2/3, 2/4, 3/4)
      effectiveConfidence = bestData.maxConf * 0.95;
      consensusSource = `${bestData.count}_of_${total}_agree`;
    } else if (total === 1) {
      // Single signal
      effectiveConfidence = bestData.maxConf;
      consensusSource = `single_${bestData.sources[0]}`;
    } else {
      // Split vote - no clear majority
      effectiveConfidence = bestData.maxConf * 0.6;
      consensusSource = 'split_vote';
    }
    
    return {
      agreed: effectiveConfidence >= CONFIG.confidenceThreshold,
      fieldType: bestType,
      confidence: effectiveConfidence,
      source: consensusSource,
      sources: bestData.sources,
      votes,
    };
  }
  
  // ============================================================================
  // MAIN CLASSIFICATION (ALL steps run for EVERY field)
  // ============================================================================
  async classifyField(field) {
    this.stats.totalFields++;
    this.currentFieldIndex++;
    
    const label = field.label || field.name || field.id || 'unknown';
    const generic = isGenericLabel(field.label);
    console.log(`\n   📋 Classifying: "${label.substring(0, 60)}..."`);
    
    // ═══════════════════════════════════
    // STEP 1: FIELD ID (always runs)
    // ═══════════════════════════════════
    const fieldIdResult = this.classifyByFieldId(field);
    if (fieldIdResult) {
      console.log(`      🔑 Field ID: ${fieldIdResult.fieldType} (${(fieldIdResult.confidence * 100).toFixed(0)}%)`);
    } else {
      console.log(`      🔑 Field ID: no match`);
    }
    
    // ═══════════════════════════════════
    // STEP 1b: CACHE (learned patterns)
    // ═══════════════════════════════════
    const cacheResult = this.classifyFromCache(field);
    if (cacheResult) {
      this.stats.cacheHits++;
      const vTag = cacheResult.verified ? '✓' : '⚠';
      console.log(`      📦 Cache:   ${cacheResult.fieldType} (${(cacheResult.confidence * 100).toFixed(0)}%) [${vTag}]`);
    } else {
      console.log(`      📦 Cache:   no match`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // QUESTIONNAIRE PATH: Generic labels like "Select One"
    // 
    // DeBERTa/BGE field classifiers are designed for SHORT labels like
    // "First Name" or "Phone Number". They can't reason about multi-sentence
    // legal questions buried in section text.
    //
    // Instead: BGE Question Bank matching (FREE) → Opus fallback (testing)
    // 
    // Flow:
    //   1. Extract actual question text from section
    //   2. BGE: Compare question against known question bank (≥82% = match)
    //   3. If no match: Claude Opus classifies (testing phase, builds quality bank)
    //   4. Learn: new question → field_type added to REVIEW QUEUE for approval
    // ═══════════════════════════════════════════════════════════════════════
    if (generic && !fieldIdResult) {
      const questionText = this.extractQuestionText(field);
      
      // --- Try Question Bank (BGE matching, FREE) ---
      const bankMatch = await this.classifyQuestionnaire(field);
      
      if (bankMatch) {
        this.stats.fromQuestionBank++;
        console.log(`      📖 Question Bank: ${bankMatch.fieldType} (${(bankMatch.confidence * 100).toFixed(1)}%) [${bankMatch.source}]`);
        console.log(`         Matched: "${bankMatch.matchedQuestion}..."`);
        
        const answer = this.getAnswerFromProfile(bankMatch.fieldType, field);
        if (answer !== undefined && answer !== null && answer !== '') {
          console.log(`      💡 Answer from profile: "${answer}"`);
        }
        
        return {
          field_type: bankMatch.fieldType,
          confidence: bankMatch.confidence,
          source: 'question_bank',
          answer,
        };
      }
      
      // --- No bank match → Claude Opus (testing phase) ---
      console.log(`      📖 Question Bank: no match${questionText ? ` (question: "${questionText.substring(0, 50)}...")` : ''}`);
      console.log(`      🌐 Opus fallback...`);
      
      const opusResult = await this.callClaudeForQuestionnaire(field, questionText);
      
      if (opusResult) {
        this.stats.fromClaude++;
        this.stats.claudeDirect++;
        console.log(`      🔄 Opus says: ${opusResult.field_type}`);
        
        const answer = this.getAnswerFromProfile(opusResult.field_type, field);
        
        // REVIEW QUEUE: Don't auto-save. Flag for manual review.
        if (questionText && CONFIG.reviewMode) {
          this.addToReviewQueue({
            store: 'question_bank',
            field_type: opusResult.field_type,
            label: field.label || '',
            question: questionText,
            answer: answer || '',
            source: 'opus_questionnaire',
            fieldId: field.id || '',
          });
        } else if (questionText) {
          await this.learnQuestionnairePattern(questionText, opusResult.field_type);
        }
        
        if (answer !== undefined && answer !== null && answer !== '') {
          console.log(`      💡 Answer from profile: "${answer}"`);
        }
        
        return {
          field_type: opusResult.field_type,
          confidence: opusResult.confidence,
          source: 'opus_direct',
          answer,
        };
      }
      
      console.log(`      ❌ Could not classify field`);
      return { field_type: 'unknown', confidence: 0, source: 'failed', answer: null };
    }
    
    // ═══════════════════════════════════
    // STEP 2: AI (DeBERTa + BGE)
    // Only for fields with meaningful labels
    // ═══════════════════════════════════
    const aiResults = await this.classifyWithAI(field);
    
    if (aiResults.zeroShot) {
      console.log(`      🧠 DeBERTa: ${aiResults.zeroShot.fieldType} (${(aiResults.zeroShot.confidence * 100).toFixed(1)}%)`);
    } else {
      console.log(`      🧠 DeBERTa: no result`);
    }
    if (aiResults.semantic) {
      console.log(`      🧠 BGE:     ${aiResults.semantic.fieldType} (${(aiResults.semantic.confidence * 100).toFixed(1)}%)`);
    } else {
      console.log(`      🧠 BGE:     no result`);
    }
    
    // ═══════════════════════════════════
    // STEP 3: CONSENSUS CHECK
    // ═══════════════════════════════════
    const consensus = this.checkConsensus(fieldIdResult, aiResults, cacheResult);
    
    if (consensus.agreed) {
      // ═══════════════════════════════════
      // STEP 4: CONSENSUS! → Profile answer
      // ═══════════════════════════════════
      this.stats.fromConsensus++;
      this.trackConsensusType(consensus.source);
      if (consensus.sources && consensus.sources.includes('cache')) {
        this.stats.cacheDecisive++;
      }
      
      console.log(`      ✅ CONSENSUS: ${consensus.fieldType} (${(consensus.confidence * 100).toFixed(1)}%) [${consensus.source}]`);
      
      // TEXTAREA GUARD: Check if Yes/No classification on a textarea
      const guardResult = await this.textareaGuard(field, consensus.fieldType, consensus.confidence, consensus.source);
      if (guardResult) {
        const guardAnswer = this.getAnswerFromProfile(guardResult.field_type, field);
        if (guardAnswer !== undefined && guardAnswer !== null && guardAnswer !== '') {
          console.log(`      💡 Answer from profile: "${guardAnswer}"`);
        }
        
        // LAYER 3: Save the CORRECTED classification so it's learned for next time
        if (!isGenericLabel(field.label)) {
          this.cache.learnPattern(field, guardResult.field_type, 'textarea_guard');
          this.stats.patternsLearned++;
          console.log(`      📚 Learned corrected pattern: ${consensus.fieldType} → ${guardResult.field_type} (textarea guard)`);
        }
        
        return { ...guardResult, answer: guardAnswer };
      }
      
      const answer = this.getAnswerFromProfile(consensus.fieldType, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      
      return {
        field_type: consensus.fieldType,
        confidence: consensus.confidence,
        source: consensus.source,
        answer,
      };
    }
    
    // ═══════════════════════════════════
    // STEP 5: NO CONSENSUS → CLAUDE
    // ═══════════════════════════════════
    if (consensus.votes.length > 0) {
      const voteStr = consensus.votes
        .map(v => `${v.source}→${v.fieldType}(${(v.confidence * 100).toFixed(0)}%)`)
        .join(', ');
      console.log(`      ⚠️ No consensus (${(consensus.confidence * 100).toFixed(1)}% < ${CONFIG.confidenceThreshold * 100}%): [${voteStr}]`);
    } else {
      console.log(`      ⚠️ No signals could classify this field`);
    }
    
    console.log(`      🌐 Falling back to Claude API...`);
    const claudeResult = await this.callClaudeForVerification(field);
    
    if (claudeResult) {
      this.stats.fromClaude++;
      console.log(`      🔄 Claude says: ${claudeResult.field_type}`);
      
      // TEXTAREA GUARD: Check if Yes/No classification on a textarea
      const guardResult = await this.textareaGuard(field, claudeResult.field_type, claudeResult.confidence, 'claude_api');
      if (guardResult) {
        const guardAnswer = this.getAnswerFromProfile(guardResult.field_type, field);
        if (guardAnswer !== undefined && guardAnswer !== null && guardAnswer !== '') {
          console.log(`      💡 Answer from profile: "${guardAnswer}"`);
        }
        
        // LAYER 3: Save the CORRECTED classification (not the wrong one Claude gave)
        if (!isGenericLabel(field.label)) {
          this.cache.learnPattern(field, guardResult.field_type, 'textarea_guard');
          this.stats.patternsLearned++;
          console.log(`      📚 Learned corrected pattern: ${claudeResult.field_type} → ${guardResult.field_type} (textarea guard)`);
        }
        
        return { ...guardResult, answer: guardAnswer };
      }
      
      // LAYER 3: Validate before learning — don't save patterns that are likely wrong
      if (!isGenericLabel(field.label)) {
        const validation = this.validateBeforeLearning(field, claudeResult.field_type);
        if (validation.valid) {
          this.cache.learnPattern(field, claudeResult.field_type, 'claude_api');
          this.stats.patternsLearned++;
        } else {
          console.log(`      ⚠️ VALIDATION WARNING: ${validation.reason}`);
          // Still learn but flag it — better to save than lose Claude's call entirely
          this.cache.learnPattern(field, claudeResult.field_type, 'claude_api_flagged');
          this.stats.patternsLearned++;
        }
      } else {
        console.log(`      ⏭️ Skipping cache (generic label "${field.label}")`);
      }
      
      const answer = this.getAnswerFromProfile(claudeResult.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      
      return {
        field_type: claudeResult.field_type,
        confidence: claudeResult.confidence,
        source: 'claude_api',
        answer,
      };
    }
    
    console.log(`      ❌ Could not classify field`);
    return { field_type: 'unknown', confidence: 0, source: 'failed', answer: null };
  }
  
  // ============================================================================
  // TRACK CONSENSUS TYPE
  // ============================================================================
  trackConsensusType(source) {
    if (source.startsWith('all_')) {
      this.stats.consensusDetails.allAgree++;
    } else if (source.includes('_of_')) {
      this.stats.consensusDetails.majorityAgree++;
    }
  }
  
  // ============================================================================
  // CALL CLAUDE API
  // ============================================================================
  async callClaudeForVerification(field) {
    if (!this.client) {
      console.warn('      ⚠️ No API client configured');
      return null;
    }
    
    // Build context-aware prompt
    const isGeneric = isGenericLabel(field.label);
    const sectionText = field.section || field.fullText || '';
    
    let prompt;
    
    if (isGeneric && sectionText.length > 20) {
      // ═══════════════════════════════════════════════════════════
      // QUESTIONNAIRE MODE: Generic label + section context
      // Parse section to find which question belongs to this field
      // ═══════════════════════════════════════════════════════════
      
      // Split section by ' | ' to get individual questions
      const sectionParts = sectionText.split(' | ').filter(s => s.trim().length > 10);
      
      // Count how many generic-label fields are on this page
      const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
      const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
      const fieldPosition = genericIndex >= 0 ? genericIndex + 1 : this.currentFieldIndex;
      
      // Build a numbered question list from section parts
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

Match dropdown #${fieldPosition} to its corresponding question, then respond with ONLY the field_type (one of the above), nothing else.`;
      
    } else {
      // ═══════════════════════════════════════════════════════════
      // STANDARD MODE: Meaningful label, straightforward
      // ═══════════════════════════════════════════════════════════
      prompt = `Classify this job application form field.

FIELD INFORMATION:
- Label: "${field.label || 'N/A'}"
- ID: "${field.id || 'N/A'}"
- Type: "${field.type || 'N/A'}"
- Options: ${field.options ? JSON.stringify(field.options.slice(0, 10)) : 'N/A'}
- Section/Context: "${sectionText.substring(0, 500)}"

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

Respond with ONLY the field_type (one of the above), nothing else.`;
    }
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      
      if (text && FIELD_TYPES.includes(text)) {
        return { field_type: text, confidence: 0.95 };
      }
    } catch (error) {
      console.warn(`      ⚠️ API error: ${error.message}`);
    }
    
    return null;
  }
  
  // ============================================================================
  // CALL CLAUDE FOR QUESTIONNAIRE FIELDS (Opus during testing, Haiku after)
  // Used ONLY when question bank has no match for a generic-label field
  // ============================================================================
  async callClaudeForQuestionnaire(field, questionText) {
    if (!this.client) {
      console.warn('      ⚠️ No API client configured');
      return null;
    }
    
    const sectionText = field.section || field.fullText || '';
    
    // Build a focused prompt with the specific question
    let prompt;
    if (questionText) {
      prompt = `Classify this job application question into a field type.

QUESTION: "${questionText}"

FIELD ID: "${field.id || 'N/A'}"
OPTIONS: ${field.options ? JSON.stringify(field.options.slice(0, 5)) : 'Yes/No'}

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

Respond with ONLY the field_type, nothing else.`;
    } else {
      // No question extracted, use section context + position
      const sectionParts = sectionText.split(' | ').filter(s => s.trim().length > 15);
      const genericFieldsOnPage = this.pageFields.filter(f => isGenericLabel(f.label));
      const genericIndex = genericFieldsOnPage.findIndex(f => f.id === field.id);
      const fieldPosition = genericIndex >= 0 ? genericIndex + 1 : this.currentFieldIndex;
      
      const questionList = sectionParts
        .map((q, i) => `  Q${i + 1}: "${q.substring(0, 300)}"`)
        .join('\n');
      
      prompt = `Classify dropdown #${fieldPosition} of ${genericFieldsOnPage.length} on a job application page.

PAGE QUESTIONS:
${questionList}

FIELD ID: "${field.id || 'N/A'}"

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

Match dropdown #${fieldPosition} to its question and respond with ONLY the field_type.`;
    }
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.questionnaireModel,     // Opus during testing
        max_tokens: CONFIG.questionnaireMaxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0]?.text?.trim().toLowerCase();
      
      if (text && FIELD_TYPES.includes(text)) {
        return { field_type: text, confidence: 0.92 };
      }
    } catch (error) {
      console.warn(`      ⚠️ Questionnaire API error: ${error.message}`);
    }
    
    return null;
  }
  
  // ============================================================================
  // GET ANSWER FROM PROFILE
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
    const total = this.stats.totalFields;
    const conPct = total > 0 ? ((this.stats.fromConsensus / total) * 100).toFixed(1) : '0.0';
    const claudePct = total > 0 ? ((this.stats.fromClaude / total) * 100).toFixed(1) : '0.0';
    
    const dConfs = this.stats.aiConfidences.deberta;
    const bConfs = this.stats.aiConfidences.bge;
    const dAvg = dConfs.length > 0 ? (dConfs.reduce((a, b) => a + b, 0) / dConfs.length * 100).toFixed(1) : 'N/A';
    const bAvg = bConfs.length > 0 ? (bConfs.reduce((a, b) => a + b, 0) / bConfs.length * 100).toFixed(1) : 'N/A';
    
    console.log('\n' + '═'.repeat(65));
    console.log('📊 FIELD CLASSIFIER v7.2 - CONSENSUS + QUESTION BANK');
    console.log('═'.repeat(65));
    console.log(`   Total Fields:           ${total}`);
    console.log('─'.repeat(65));
    console.log(`   ✅ Consensus (≥85%):     ${this.stats.fromConsensus} (${conPct}%)`);
    console.log(`      ├── All agree:        ${this.stats.consensusDetails.allAgree}`);
    console.log(`      └── Majority agree:   ${this.stats.consensusDetails.majorityAgree}`);
    console.log(`   📦 Cache Votes:          ${this.stats.cacheHits} (decisive: ${this.stats.cacheDecisive})`);
    console.log(`   📖 Question Bank (FREE): ${this.stats.fromQuestionBank}`);
    console.log(`   🌐 Claude API:           ${this.stats.fromClaude} (${claudePct}%)`);
    if (this.stats.claudeDirect > 0) {
      console.log(`      ├── 🧠 Opus (quest):  ${this.stats.claudeDirect}`);
      console.log(`      └── 🧠 Opus (std):    ${this.stats.fromClaude - this.stats.claudeDirect}`);
    }
    console.log(`   📚 Patterns Learned:     ${this.stats.patternsLearned}`);
    console.log(`   🔍 Pending Review:       ${this.stats.pendingReview}`);
    console.log(`   📖 Questions in Bank:    ${this.questionBank.length}`);
    console.log('─'.repeat(65));
    
    // Cost estimate (Opus = ~$0.015/call during testing)
    const freeFields = this.stats.fromConsensus + this.stats.fromQuestionBank;
    const opusCalls = this.stats.fromClaude;
    const estCost = opusCalls * 0.015;
    const fullCost = total * 0.015; // If everything went to Opus
    const saved = fullCost - estCost;
    if (total > 0) {
      console.log(`   💰 Est. Cost This Page:  $${estCost.toFixed(4)} (saved ~$${saved.toFixed(4)} vs all-Opus)`);
      console.log(`      ${freeFields} free (local) + ${opusCalls} Opus`);
      if (CONFIG.reviewMode) {
        console.log(`   🔍 Review Mode:          ON (nothing auto-saved)`);
      }
    }
    
    console.log('─'.repeat(65));
    console.log(`   🧠 AI Avg Confidence:`);
    console.log(`      ├── DeBERTa:          ${dAvg}%`);
    console.log(`      └── BGE:              ${bAvg}%`);
    console.log('═'.repeat(65) + '\n');
    
    this.cache.printStats();
    
    // Show review queue summary if there are pending items
    this.printReviewQueueSummary();
  }
  
  getLearnedPatternsCount() {
    return Object.keys(this.cache.learnedPatterns).length;
  }
}

export default VerifiedFieldClassifier;
export { VerifiedFieldClassifier, FIELD_TYPES };
