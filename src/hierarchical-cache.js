/**
 * Hierarchical Cache v3 - WITH LEARNING!
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: This cache stores FIELD TYPES only, NEVER actual answers!      ║
 * ║                                                                           ║
 * ║  NEW IN v3: LEARNING FROM CLAUDE API CALLS                                ║
 * ║    - When Claude classifies a field, we save the pattern                  ║
 * ║    - Next time ANY user sees that field, we don't call Claude             ║
 * ║    - Patterns are saved to learned-patterns.json                          ║
 * ║                                                                           ║
 * ║  COST SAVINGS MATH:                                                       ║
 * ║    - 500 users × 500 apps × 10 API calls = 2,500,000 API calls            ║
 * ║    - With learning: ~500 unique patterns learned, then FREE               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * CACHE LEVELS:
 *   Level 0: Global - Built-in label patterns (First Name, Email, etc.)
 *   Level 1: ATS - Platform-specific field ID patterns (Workday's countryRegion = state)
 *   Level 2: Question - Built-in question text patterns
 *   Level 3: Learned - Patterns learned from Claude API (PERSISTED TO FILE!)
 *   Level 4: Runtime - Session-only patterns (not persisted)
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
    { pattern: /phoneType/i, type: 'phone_type' },  // NEW: Phone device type
    
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
    { pattern: /--ethnicity$/i, type: 'race_ethnicity' },
    
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
  
  taleo: [
    // Add Taleo patterns here as discovered
    { pattern: /firstName/i, type: 'first_name' },
    { pattern: /lastName/i, type: 'last_name' },
  ],
  
  icims: [
    // Add iCIMS patterns here as discovered
    { pattern: /firstName/i, type: 'first_name' },
    { pattern: /lastName/i, type: 'last_name' },
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
  { pattern: /have\s*you.*worked\s*for/i, type: 'previously_employed' },
  
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
// HIERARCHICAL CACHE CLASS WITH LEARNING
// ============================================================================
class HierarchicalCache {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || './cache';
    this.learnedPatternsFile = path.join(this.cacheDir, 'learned-patterns.json');
    
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Statistics
    this.stats = {
      level0Hits: 0,  // Global
      level1Hits: 0,  // ATS
      level2Hits: 0,  // Question
      level3Hits: 0,  // Learned (from file)
      level4Hits: 0,  // Runtime
      misses: 0,
    };
    
    // Runtime cache (session only, not persisted)
    this.runtimeCache = new Map();
    
    // Learned patterns (loaded from file, persisted)
    this.learnedPatterns = this.loadLearnedPatterns();
    
    console.log(`[Cache] Loaded ${Object.keys(this.learnedPatterns).length} learned patterns from file`);
  }
  
  // ============================================================================
  // LOAD/SAVE LEARNED PATTERNS
  // ============================================================================
  loadLearnedPatterns() {
    try {
      if (fs.existsSync(this.learnedPatternsFile)) {
        const data = fs.readFileSync(this.learnedPatternsFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn(`[Cache] Could not load learned patterns: ${error.message}`);
    }
    return {};
  }
  
  saveLearnedPatterns() {
    try {
      // Ensure cache directory exists
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.learnedPatternsFile,
        JSON.stringify(this.learnedPatterns, null, 2),
        'utf-8'
      );
      console.log(`[Cache] Saved ${Object.keys(this.learnedPatterns).length} learned patterns to file`);
    } catch (error) {
      console.warn(`[Cache] Could not save learned patterns: ${error.message}`);
    }
  }
  
  // ============================================================================
  // LEARN A NEW PATTERN (Called after Claude API response)
  // ============================================================================
  learnPattern(field, fieldType, source = 'claude') {
    // Create a normalized key from the field
    const key = this.createLearnedKey(field);
    if (!key) return;
    
    // Don't overwrite existing patterns
    if (this.learnedPatterns[key]) {
      return;
    }
    
    // Store the learned pattern (TYPE ONLY, never the answer!)
    this.learnedPatterns[key] = {
      type: fieldType,
      learnedFrom: source,
      learnedAt: new Date().toISOString(),
      ats: this.currentATS,
      company: this.currentCompany,
      originalLabel: field.label,
      originalId: field.id,
    };
    
    console.log(`   📚 LEARNED: "${key}" → ${fieldType}`);
    
    // Save to file immediately
    this.saveLearnedPatterns();
  }
  
  // ============================================================================
  // CREATE NORMALIZED KEY FOR LEARNED PATTERNS
  // ============================================================================
  createLearnedKey(field) {
    // We want to create a key that will match similar fields
    // But be specific enough to not cause false matches
    
    const parts = [];
    
    // Use ATS as prefix for platform-specific patterns
    parts.push(this.currentATS);
    
    // Add label (normalized)
    if (field.label) {
      const normalizedLabel = field.label
        .toLowerCase()
        .replace(/[*:\s]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 50);  // Limit length
      parts.push(`label:${normalizedLabel}`);
    }
    
    // Add field ID pattern (extract meaningful part)
    if (field.id) {
      // Extract the last part of the ID (usually most meaningful)
      const idParts = field.id.split('--');
      const meaningfulPart = idParts[idParts.length - 1]
        .replace(/[0-9a-f]{8,}/gi, '*')  // Replace UUIDs with wildcard
        .toLowerCase();
      parts.push(`id:${meaningfulPart}`);
    }
    
    // Add element type (helps distinguish dropdown vs textarea)
    if (field.type) {
      parts.push(`type:${field.type}`);
    }
    
    return parts.join('|');
  }
  
  // ============================================================================
  // SET CONTEXT
  // ============================================================================
  setContext(url) {
    this.currentATS = detectATS(url);
    this.currentCompany = extractCompany(url);
    console.log(`[Cache] Context: ATS=${this.currentATS}, Company=${this.currentCompany}`);
  }
  
  // ============================================================================
  // MAIN LOOKUP METHOD
  // ============================================================================
  lookup(field) {
    // Level 0: Global label patterns
    const globalResult = this.checkGlobalPatterns(field);
    if (globalResult) {
      this.stats.level0Hits++;
      return { ...globalResult, cacheLevel: 'global' };
    }
    
    // Level 1: ATS-specific field ID patterns
    const atsResult = this.checkATSPatterns(field);
    if (atsResult) {
      this.stats.level1Hits++;
      return { ...atsResult, cacheLevel: 'ats' };
    }
    
    // Level 2: Question text patterns
    const questionResult = this.checkQuestionPatterns(field);
    if (questionResult) {
      this.stats.level2Hits++;
      return { ...questionResult, cacheLevel: 'question' };
    }
    
    // Level 3: Learned patterns (from file)
    const learnedResult = this.checkLearnedPatterns(field);
    if (learnedResult) {
      this.stats.level3Hits++;
      return { ...learnedResult, cacheLevel: 'learned' };
    }
    
    // Level 4: Runtime cache (session only)
    const runtimeResult = this.checkRuntimeCache(field);
    if (runtimeResult) {
      this.stats.level4Hits++;
      return { ...runtimeResult, cacheLevel: 'runtime' };
    }
    
    // Miss - will need Claude API
    this.stats.misses++;
    return null;
  }
  
  // ============================================================================
  // LEVEL 0: CHECK GLOBAL PATTERNS
  // ============================================================================
  checkGlobalPatterns(field) {
    const label = field.label || '';
    
    for (const { pattern, type } of GLOBAL_LABEL_PATTERNS) {
      if (pattern.test(label)) {
        return { field_type: type, confidence: 0.95 };
      }
    }
    return null;
  }
  
  // ============================================================================
  // LEVEL 1: CHECK ATS-SPECIFIC PATTERNS
  // ============================================================================
  checkATSPatterns(field) {
    const patterns = ATS_FIELD_ID_PATTERNS[this.currentATS];
    if (!patterns) return null;
    
    const fieldId = field.id || field.name || '';
    
    for (const { pattern, type } of patterns) {
      if (pattern.test(fieldId)) {
        return { field_type: type, confidence: 0.95 };
      }
    }
    return null;
  }
  
  // ============================================================================
  // LEVEL 2: CHECK QUESTION TEXT PATTERNS
  // ============================================================================
  checkQuestionPatterns(field) {
    // Combine all available text
    const allText = [
      field.label || '',
      field.section || '',
      field.fullText || '',
      field.placeholder || '',
    ].join(' ').toLowerCase();
    
    for (const { pattern, type } of QUESTION_TEXT_PATTERNS) {
      if (pattern.test(allText)) {
        return { field_type: type, confidence: 0.90 };
      }
    }
    return null;
  }
  
  // ============================================================================
  // LEVEL 3: CHECK LEARNED PATTERNS
  // ============================================================================
  checkLearnedPatterns(field) {
    const key = this.createLearnedKey(field);
    if (!key) return null;
    
    const learned = this.learnedPatterns[key];
    if (learned) {
      return { 
        field_type: learned.type, 
        confidence: 0.90,
        learnedFrom: learned.learnedFrom,
      };
    }
    
    // Also try matching by label alone (more generic)
    const labelKey = `${this.currentATS}|label:${(field.label || '').toLowerCase().replace(/[*:\s]+/g, '_')}`;
    const labelLearned = this.learnedPatterns[labelKey];
    if (labelLearned) {
      return { 
        field_type: labelLearned.type, 
        confidence: 0.85,
        learnedFrom: labelLearned.learnedFrom,
      };
    }
    
    return null;
  }
  
  // ============================================================================
  // LEVEL 4: CHECK RUNTIME CACHE
  // ============================================================================
  checkRuntimeCache(field) {
    const key = this.createCacheKey(field);
    const cached = this.runtimeCache.get(key);
    if (cached) {
      return { field_type: cached.type, confidence: 0.85 };
    }
    return null;
  }
  
  // ============================================================================
  // CREATE RUNTIME CACHE KEY
  // ============================================================================
  createCacheKey(field) {
    return `${this.currentATS}:${this.currentCompany}:${field.id || ''}:${field.label || ''}:${field.type || ''}`;
  }
  
  // ============================================================================
  // ADD TO RUNTIME CACHE
  // ============================================================================
  addToRuntimeCache(field, fieldType) {
    const key = this.createCacheKey(field);
    this.runtimeCache.set(key, { type: fieldType, timestamp: Date.now() });
  }
  
  // ============================================================================
  // GET STATISTICS
  // ============================================================================
  getStats() {
    const total = this.stats.level0Hits + this.stats.level1Hits + 
                  this.stats.level2Hits + this.stats.level3Hits + 
                  this.stats.level4Hits + this.stats.misses;
    const hits = total - this.stats.misses;
    
    return {
      ...this.stats,
      totalLookups: total,
      hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0',
      runtimeCacheSize: this.runtimeCache.size,
      learnedPatternsCount: Object.keys(this.learnedPatterns).length,
    };
  }
  
  // ============================================================================
  // PRINT STATISTICS
  // ============================================================================
  printStats() {
    const stats = this.getStats();
    console.log('\n' + '═'.repeat(60));
    console.log('📦 HIERARCHICAL CACHE STATISTICS (v3 - With Learning!)');
    console.log('═'.repeat(60));
    console.log(`   ATS: ${this.currentATS} | Company: ${this.currentCompany}`);
    console.log('─'.repeat(60));
    console.log(`   Level 0 (Global Labels):   ${stats.level0Hits} hits`);
    console.log(`   Level 1 (ATS Field IDs):   ${stats.level1Hits} hits`);
    console.log(`   Level 2 (Question Text):   ${stats.level2Hits} hits`);
    console.log(`   Level 3 (Learned):         ${stats.level3Hits} hits  ← FROM FILE!`);
    console.log(`   Level 4 (Runtime):         ${stats.level4Hits} hits`);
    console.log(`   Misses (→ Claude):         ${stats.misses}`);
    console.log('─'.repeat(60));
    console.log(`   Total Hit Rate: ${stats.hitRate}%`);
    console.log('─'.repeat(60));
    console.log(`   Learned Patterns (saved): ${stats.learnedPatternsCount}`);
    console.log(`   Runtime Cache (session):  ${stats.runtimeCacheSize}`);
    console.log('═'.repeat(60) + '\n');
  }
}

export default HierarchicalCache;
