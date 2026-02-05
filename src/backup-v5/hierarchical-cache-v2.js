/**
 * Hierarchical Cache v2 - CORRECT DESIGN
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: This cache stores FIELD TYPES only, NEVER actual answers!      ║
 * ║                                                                           ║
 * ║  WHY? Because answers are USER-SPECIFIC:                                  ║
 * ║    - User A (H1B holder): "US Citizen?" → "No"                            ║
 * ║    - User B (US Citizen): "US Citizen?" → "Yes"                           ║
 * ║                                                                           ║
 * ║  If we cached "No", User B would get the WRONG answer!                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * CORRECT FLOW:
 *   1. Field: "Are you a US Citizen?"
 *   2. Cache: "This is asking about citizenship_status"
 *   3. Profile: user.workAuth.isUSCitizenOrPR → true/false
 *   4. Answer: "Yes" for User B, "No" for User A
 * 
 * CACHE LEVELS:
 *   Level 0: Global - Built-in patterns (First Name, Email, etc.)
 *   Level 1: ATS - Platform-specific patterns (Workday's countryRegion = state)
 *   Level 2: Question - Patterns in question text
 *   Level 3: Runtime - Learned during this session
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// ATS DETECTION
// ============================================================================
export function detectATS(url) {
  if (!url) return 'unknown';
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('myworkdayjobs.com') || urlLower.includes('workday.com')) return 'workday';
  if (urlLower.includes('taleo.net') || urlLower.includes('taleo.com')) return 'taleo';
  if (urlLower.includes('icims.com')) return 'icims';
  if (urlLower.includes('successfactors')) return 'successfactors';
  if (urlLower.includes('greenhouse.io')) return 'greenhouse';
  if (urlLower.includes('lever.co')) return 'lever';
  
  return 'unknown';
}

// ============================================================================
// COMPANY EXTRACTION
// ============================================================================
export function extractCompany(url) {
  if (!url) return 'unknown';
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Workday: analogdevices.wd1.myworkdayjobs.com → analogdevices
    const workdayMatch = hostname.match(/^([^.]+)\.wd\d*\.myworkdayjobs\.com/);
    if (workdayMatch) return workdayMatch[1];
    
    // Taleo: companyname.taleo.net → companyname
    const taleoMatch = hostname.match(/^([^.]+)\.taleo\.net/);
    if (taleoMatch) return taleoMatch[1];
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// LEVEL 0: GLOBAL PATTERNS (Universal label matching)
// These are labels that mean the same thing everywhere
// ============================================================================
const GLOBAL_LABEL_PATTERNS = [
  // Personal - EXACT matches (anchored with ^...$)
  { pattern: /^first\s*name\*?$/i, type: 'first_name' },
  { pattern: /^last\s*name\*?$/i, type: 'last_name' },
  { pattern: /^middle\s*name\*?$/i, type: 'middle_name' },
  { pattern: /^name\*?$/i, type: 'full_name' },
  { pattern: /^email\s*(address)?\*?$/i, type: 'email' },
  
  // Address
  { pattern: /^address\s*line\s*1\*?$/i, type: 'address_line_1' },
  { pattern: /^street\s*address\*?$/i, type: 'address_line_1' },
  { pattern: /^address\s*line\s*2/i, type: 'address_line_2' },
  { pattern: /^city\*?$/i, type: 'city' },
  { pattern: /^state\s/i, type: 'state' },
  { pattern: /^postal\s*code\*?$/i, type: 'postal_code' },
  { pattern: /^zip\s*code/i, type: 'postal_code' },
  
  // Phone - IMPORTANT: Extension pattern BEFORE phone number!
  { pattern: /phone\s*extension/i, type: 'phone_extension' },
  { pattern: /^phone\s*number\*?$/i, type: 'phone_number' },
  { pattern: /^country\s*phone\s*code/i, type: 'country_phone_code' },
  
  // Education
  { pattern: /^school\s*(or\s*university)?\*?$/i, type: 'school' },
  { pattern: /^field\s*of\s*study\*?$/i, type: 'field_of_study' },
  { pattern: /^degree\s/i, type: 'degree' },
  
  // Documents
  { pattern: /resume.*upload|upload.*resume/i, type: 'resume_upload' },
  { pattern: /^resume\/cv/i, type: 'resume_upload' },
  { pattern: /cover\s*letter/i, type: 'cover_letter_upload' },
  { pattern: /linkedin/i, type: 'linkedin' },
  
  // EEO
  { pattern: /^gender\s/i, type: 'gender' },
  { pattern: /^hispanic\s*(or|\/)\s*latino\*?$/i, type: 'hispanic_latino' },
  { pattern: /^race.*ethnicity\*?$/i, type: 'race_ethnicity' },
  { pattern: /^veteran/i, type: 'veteran_status' },
  
  // Referral
  { pattern: /how\s*did\s*you\s*hear/i, type: 'referral_source' },
  
  // Agreements
  { pattern: /accept.*terms|terms.*conditions/i, type: 'terms_agreement' },
];

// ============================================================================
// LEVEL 1: ATS-SPECIFIC PATTERNS (Field ID patterns per platform)
// ============================================================================
const ATS_FIELD_ID_PATTERNS = {
  workday: [
    // *** CRITICAL: More specific patterns MUST come FIRST! ***
    
    // Phone - extension BEFORE phoneNumber
    { pattern: /--extension$/i, type: 'phone_extension' },
    { pattern: /phoneNumber--phoneNumber/i, type: 'phone_number' },
    { pattern: /countryPhoneCode/i, type: 'country_phone_code' },
    
    // CRITICAL FIX: Workday's countryRegion is STATE, not country!
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
    
    // Employment
    { pattern: /candidateIsPreviousWorker/i, type: 'previously_employed' },
    
    // Education - IMPORTANT: fieldOfStudy BEFORE school
    { pattern: /--fieldOfStudy$/i, type: 'field_of_study' },
    { pattern: /--school$/i, type: 'school' },
    { pattern: /--degree$/i, type: 'degree' },
    
    // EEO / Self-ID
    { pattern: /hispanicOrLatino/i, type: 'hispanic_latino' },
    { pattern: /--gender$/i, type: 'gender' },
    { pattern: /veteranStatus/i, type: 'veteran_status' },
    { pattern: /ethnicityMulti/i, type: 'race_ethnicity' },
    
    // Disability form - These need special handling!
    { pattern: /selfIdentifiedDisabilityData--name$/i, type: 'full_name' },  // NOT disability!
    { pattern: /selfIdentifiedDisabilityData--employeeId/i, type: 'employee_id' },
    { pattern: /selfIdentifiedDisabilityData--disabilityStatus/i, type: 'disability_status' },
    { pattern: /dateSignedOn/i, type: 'signature_date' },
    
    // Agreements
    { pattern: /acceptTermsAndAgreements/i, type: 'terms_agreement' },
    
    // Source/Referral
    { pattern: /^source--source/i, type: 'referral_source' },
    
    // Skills
    { pattern: /skills/i, type: 'skills' },
  ],
};

// ============================================================================
// LEVEL 2: QUESTION TEXT PATTERNS (Match the actual question being asked)
// ORDER MATTERS! More specific patterns MUST come FIRST!
// ============================================================================
const QUESTION_TEXT_PATTERNS = [
  // =========================================
  // WORK AUTHORIZATION - Order is critical!
  // =========================================
  
  // Most specific first: "indefinite" questions
  { pattern: /authorized.*work.*indefinite/i, type: 'work_authorization_indefinite' },
  { pattern: /indefinite\s*basis/i, type: 'work_authorization_indefinite' },
  
  // Sponsorship questions (before general work auth)
  { pattern: /will\s*you.*need.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /need.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /require.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /sponsored\s*for.*work\s*visa/i, type: 'visa_sponsorship' },
  
  // General work authorization (after specific patterns)
  { pattern: /authorized\s*to\s*work.*united\s*states/i, type: 'work_authorization' },
  { pattern: /legally.*authorized.*work/i, type: 'work_authorization' },
  
  // =========================================
  // CITIZENSHIP
  // =========================================
  { pattern: /are you.*u\.?s\.?\s*citizen/i, type: 'citizenship_status' },
  { pattern: /citizen.*permanent\s*resident.*protected/i, type: 'citizenship_status' },
  { pattern: /u\.?s\.?\s*citizen.*permanent\s*resident/i, type: 'citizenship_status' },
  
  // Foreign permanent resident (specific question)
  { pattern: /permanent\s*resident.*another\s*country/i, type: 'foreign_permanent_resident' },
  
  // =========================================
  // EXPORT CONTROL / RESTRICTED COUNTRIES
  // =========================================
  { pattern: /citizen.*cuba.*iran.*north\s*korea.*syria/i, type: 'restricted_country_citizen' },
  { pattern: /citizen.*group\s*d/i, type: 'group_d_country_citizen' },
  { pattern: /countries.*cuba.*iran/i, type: 'restricted_country_citizen' },
  { pattern: /please\s*add\s*your\s*country\s*of\s*citizenship/i, type: 'citizenship_country_text' },
  
  // =========================================
  // AGE VERIFICATION
  // =========================================
  { pattern: /at\s*least\s*18\s*years?\s*old/i, type: 'age_verification' },
  { pattern: /are\s*you\s*18/i, type: 'age_verification' },
  
  // =========================================
  // EMPLOYMENT QUESTIONS
  // =========================================
  { pattern: /previously.*employed/i, type: 'previously_employed' },
  { pattern: /employed.*before/i, type: 'previously_employed' },
  
  // Relatives - be specific!
  { pattern: /relatives?.*working\s*at/i, type: 'relative_at_company' },
  { pattern: /do\s*you.*have\s*relatives/i, type: 'relative_at_company' },
  { pattern: /policy.*employment\s*of\s*relatives/i, type: 'relative_at_company' },
  
  // Other commitments
  { pattern: /commitment.*another.*organization/i, type: 'other_commitments' },
  { pattern: /commitments.*might.*conflict/i, type: 'other_commitments' },
  
  // Restrictive agreements
  { pattern: /non-?compete/i, type: 'restrictive_agreement' },
  { pattern: /restrictive.*agreement/i, type: 'restrictive_agreement' },
  { pattern: /bound.*agreement/i, type: 'restrictive_agreement' },
  
  // =========================================
  // CONSENT QUESTIONS
  // =========================================
  { pattern: /artificial\s*intelligence.*recruit/i, type: 'ai_recruitment_consent' },
  { pattern: /additional.*future.*job/i, type: 'future_opportunities_consent' },
  { pattern: /consider\s*you\s*for\s*additional/i, type: 'future_opportunities_consent' },
  
  // =========================================
  // OTHER
  // =========================================
  { pattern: /work\s*permit.*under\s*18/i, type: 'minor_work_permit' },
  
  // Disability - be specific to avoid false matches
  { pattern: /please\s*check\s*one.*boxes.*below/i, type: 'disability_status' },
  { pattern: /voluntary.*self.*identification.*disability/i, type: 'disability_status' },
];

// ============================================================================
// NORMALIZE TEXT FOR MATCHING
// ============================================================================
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// HIERARCHICAL CACHE CLASS
// ============================================================================
class HierarchicalCache {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || './cache';
    
    // Current context
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Runtime learned patterns (NOT pre-loaded!)
    this.runtimeCache = new Map();
    
    // Statistics
    this.stats = {
      globalHits: 0,
      atsHits: 0,
      questionHits: 0,
      runtimeHits: 0,
      misses: 0,
    };
  }
  
  // ============================================================================
  // SET CONTEXT FROM URL
  // ============================================================================
  setContext(url) {
    this.currentATS = detectATS(url);
    this.currentCompany = extractCompany(url);
    console.log(`[Cache] Context: ATS=${this.currentATS}, Company=${this.currentCompany}`);
  }
  
  // ============================================================================
  // GET - Returns FIELD TYPE only (answer comes from profile!)
  // ============================================================================
  get(field) {
    const fieldId = field.id || field.name || '';
    const label = field.label || '';
    const questionText = field.section || label;
    const elementType = field.type || 'unknown';
    
    // =========================================
    // LEVEL 0: Global label patterns
    // =========================================
    for (const { pattern, type } of GLOBAL_LABEL_PATTERNS) {
      if (pattern.test(label)) {
        this.stats.globalHits++;
        return {
          field_type: type,
          cacheLevel: 'global',
          confidence: 95,
          matchedOn: 'label',
        };
      }
    }
    
    // =========================================
    // LEVEL 1: ATS-specific field ID patterns
    // =========================================
    const atsPatterns = ATS_FIELD_ID_PATTERNS[this.currentATS] || [];
    for (const { pattern, type } of atsPatterns) {
      if (pattern.test(fieldId)) {
        this.stats.atsHits++;
        return {
          field_type: type,
          cacheLevel: 'ats',
          confidence: 95,
          matchedOn: 'fieldId',
        };
      }
    }
    
    // =========================================
    // LEVEL 2: Question text patterns
    // =========================================
    for (const { pattern, type } of QUESTION_TEXT_PATTERNS) {
      if (pattern.test(questionText)) {
        this.stats.questionHits++;
        return {
          field_type: type,
          cacheLevel: 'question',
          confidence: 90,
          matchedOn: 'questionText',
        };
      }
    }
    
    // =========================================
    // LEVEL 3: Runtime learned (this session)
    // =========================================
    const runtimeKey = this.makeRuntimeKey(field);
    if (this.runtimeCache.has(runtimeKey)) {
      this.stats.runtimeHits++;
      return {
        ...this.runtimeCache.get(runtimeKey),
        cacheLevel: 'runtime',
      };
    }
    
    // Cache miss
    this.stats.misses++;
    return null;
  }
  
  // ============================================================================
  // SET - Store field type (learned from Claude)
  // ============================================================================
  set(field, result) {
    const runtimeKey = this.makeRuntimeKey(field);
    
    // ONLY store field_type, NEVER the answer!
    this.runtimeCache.set(runtimeKey, {
      field_type: result.field_type,
      confidence: result.confidence || 90,
    });
  }
  
  // ============================================================================
  // MAKE RUNTIME KEY - Includes element type to prevent collisions
  // ============================================================================
  makeRuntimeKey(field) {
    const questionText = field.section || field.label || '';
    const elementType = field.type || 'unknown';  // dropdown vs textarea vs text
    
    // Include element type in key to prevent:
    // - "Are you authorized?" (dropdown) → "Yes/No"
    // - "Are you authorized? Please explain" (textarea) → explanation text
    return `${this.currentATS}:${this.currentCompany}:${elementType}:${normalizeText(questionText).substring(0, 80)}`;
  }
  
  // ============================================================================
  // STATISTICS
  // ============================================================================
  getStats() {
    const total = this.stats.globalHits + this.stats.atsHits + 
                  this.stats.questionHits + this.stats.runtimeHits + this.stats.misses;
    const hits = total - this.stats.misses;
    
    return {
      ...this.stats,
      total,
      hits,
      hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%',
      runtimeCacheSize: this.runtimeCache.size,
    };
  }
  
  printStats() {
    const stats = this.getStats();
    console.log('\n' + '═'.repeat(60));
    console.log('📦 HIERARCHICAL CACHE STATISTICS (v2 - Types Only)');
    console.log('═'.repeat(60));
    console.log(`   ATS: ${this.currentATS} | Company: ${this.currentCompany}`);
    console.log('─'.repeat(60));
    console.log(`   Level 0 (Global Labels):   ${stats.globalHits} hits`);
    console.log(`   Level 1 (ATS Field IDs):   ${stats.atsHits} hits`);
    console.log(`   Level 2 (Question Text):   ${stats.questionHits} hits`);
    console.log(`   Level 3 (Runtime):         ${stats.runtimeHits} hits`);
    console.log(`   Misses (→ Claude):         ${stats.misses}`);
    console.log('─'.repeat(60));
    console.log(`   Total Hit Rate: ${stats.hitRate}`);
    console.log('─'.repeat(60));
    console.log(`   Runtime Cache Size: ${stats.runtimeCacheSize}`);
    console.log('═'.repeat(60) + '\n');
  }
}

export default HierarchicalCache;
