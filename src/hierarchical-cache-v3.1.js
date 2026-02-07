/**
 * Hierarchical Cache v3.1 - WITH LEARNING + VERIFICATION TRACKING
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NEW IN v3.1: VERIFICATION STATUS                                         ║
 * ║                                                                           ║
 * ║  Each learned pattern now tracks:                                         ║
 * ║    - verified: true/false (has human reviewed this?)                      ║
 * ║    - verifiedAt: timestamp of verification                                ║
 * ║    - verifiedBy: who verified (for audit trail)                           ║
 * ║    - usageCount: how many times this pattern was used                     ║
 * ║    - lastUsedAt: when it was last used                                    ║
 * ║                                                                           ║
 * ║  STAGED LEARNING:                                                         ║
 * ║    Phase 1: All patterns learned during dev = auto-verified               ║
 * ║    Phase 2: New patterns from users = unverified (needs review)           ║
 * ║    Phase 3: Mature system = very few new patterns                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
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
// ============================================================================
const GLOBAL_LABEL_PATTERNS = [
  // Personal - EXACT matches
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
  
  // Phone - Extension BEFORE phone number!
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
// LEVEL 1: ATS-SPECIFIC PATTERNS
// ============================================================================
const ATS_FIELD_ID_PATTERNS = {
  workday: [
    // Phone - extension BEFORE phoneNumber
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
    
    // Employment
    { pattern: /candidateIsPreviousWorker/i, type: 'previously_employed' },
    
    // Education - fieldOfStudy BEFORE school
    { pattern: /--fieldOfStudy$/i, type: 'field_of_study' },
    { pattern: /--school$/i, type: 'school' },
    { pattern: /--degree$/i, type: 'degree' },
    
    // EEO
    { pattern: /hispanicOrLatino/i, type: 'hispanic_latino' },
    { pattern: /--gender$/i, type: 'gender' },
    { pattern: /veteranStatus/i, type: 'veteran_status' },
    { pattern: /ethnicityMulti/i, type: 'race_ethnicity' },
    { pattern: /--ethnicity$/i, type: 'race_ethnicity' },
    
    // Disability form
    { pattern: /selfIdentifiedDisabilityData--name$/i, type: 'full_name' },
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
    { pattern: /firstName/i, type: 'first_name' },
    { pattern: /lastName/i, type: 'last_name' },
  ],
  
  icims: [
    { pattern: /firstName/i, type: 'first_name' },
    { pattern: /lastName/i, type: 'last_name' },
  ],
};

// ============================================================================
// LEVEL 2: QUESTION TEXT PATTERNS
// ============================================================================
const QUESTION_TEXT_PATTERNS = [
  // Work Authorization - Order critical!
  { pattern: /authorized.*work.*indefinite/i, type: 'work_authorization_indefinite' },
  { pattern: /indefinite\s*basis/i, type: 'work_authorization_indefinite' },
  { pattern: /will\s*you.*need.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /need.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /require.*sponsor/i, type: 'visa_sponsorship' },
  { pattern: /sponsored\s*for.*work\s*visa/i, type: 'visa_sponsorship' },
  { pattern: /authorized\s*to\s*work.*united\s*states/i, type: 'work_authorization' },
  { pattern: /legally.*authorized.*work/i, type: 'work_authorization' },
  
  // Citizenship
  { pattern: /are you.*u\.?s\.?\s*citizen/i, type: 'citizenship_status' },
  { pattern: /citizen.*permanent\s*resident.*protected/i, type: 'citizenship_status' },
  { pattern: /u\.?s\.?\s*citizen.*permanent\s*resident/i, type: 'citizenship_status' },
  { pattern: /permanent\s*resident.*another\s*country/i, type: 'foreign_permanent_resident' },
  
  // Export Control
  { pattern: /citizen.*cuba.*iran.*north\s*korea.*syria/i, type: 'restricted_country_citizen' },
  { pattern: /citizen.*group\s*d/i, type: 'group_d_country_citizen' },
  { pattern: /countries.*cuba.*iran/i, type: 'restricted_country_citizen' },
  { pattern: /please\s*add\s*your\s*country\s*of\s*citizenship/i, type: 'citizenship_country_text' },
  
  // Age
  { pattern: /at\s*least\s*18\s*years?\s*old/i, type: 'age_verification' },
  { pattern: /are\s*you\s*18/i, type: 'age_verification' },
  
  // Employment
  { pattern: /previously.*employed/i, type: 'previously_employed' },
  { pattern: /employed.*before/i, type: 'previously_employed' },
  { pattern: /have\s*you.*worked\s*for/i, type: 'previously_employed' },
  { pattern: /relatives?.*working\s*at/i, type: 'relative_at_company' },
  { pattern: /do\s*you.*have\s*relatives/i, type: 'relative_at_company' },
  { pattern: /policy.*employment\s*of\s*relatives/i, type: 'relative_at_company' },
  { pattern: /commitment.*another.*organization/i, type: 'other_commitments' },
  { pattern: /commitments.*might.*conflict/i, type: 'other_commitments' },
  { pattern: /non-?compete/i, type: 'restrictive_agreement' },
  { pattern: /restrictive.*agreement/i, type: 'restrictive_agreement' },
  { pattern: /bound.*agreement/i, type: 'restrictive_agreement' },
  
  // Consent
  { pattern: /artificial\s*intelligence.*recruit/i, type: 'ai_recruitment_consent' },
  { pattern: /additional.*future.*job/i, type: 'future_opportunities_consent' },
  { pattern: /consider\s*you\s*for\s*additional/i, type: 'future_opportunities_consent' },
  
  // Other
  { pattern: /work\s*permit.*under\s*18/i, type: 'minor_work_permit' },
  { pattern: /please\s*check\s*one.*boxes.*below/i, type: 'disability_status' },
  { pattern: /voluntary.*self.*identification.*disability/i, type: 'disability_status' },
];

// ============================================================================
// HIERARCHICAL CACHE CLASS WITH VERIFICATION TRACKING
// ============================================================================
class HierarchicalCache {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || './cache';
    this.learnedPatternsFile = path.join(this.cacheDir, 'learned-patterns.json');
    
    // Phase configuration
    this.phase = options.phase || 'development';  // 'development', 'early_users', 'production'
    this.autoVerifyInDevelopment = options.autoVerifyInDevelopment !== false;
    
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Statistics
    this.stats = {
      level0Hits: 0,
      level1Hits: 0,
      level2Hits: 0,
      level3Hits: 0,
      level3VerifiedHits: 0,
      level3UnverifiedHits: 0,
      level4Hits: 0,
      misses: 0,
    };
    
    // Runtime cache
    this.runtimeCache = new Map();
    
    // Learned patterns
    this.learnedPatterns = this.loadLearnedPatterns();
    
    const total = Object.keys(this.learnedPatterns).length;
    const verified = Object.values(this.learnedPatterns).filter(p => p.verified).length;
    console.log(`[Cache] Loaded ${total} learned patterns (${verified} verified, ${total - verified} unverified)`);
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
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.learnedPatternsFile,
        JSON.stringify(this.learnedPatterns, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.warn(`[Cache] Could not save learned patterns: ${error.message}`);
    }
  }
  
  // ============================================================================
  // LEARN A NEW PATTERN
  // ============================================================================
  learnPattern(field, fieldType, source = 'claude') {
    const key = this.createLearnedKey(field);
    if (!key) return;
    
    // Don't overwrite existing patterns
    if (this.learnedPatterns[key]) {
      // But do update usage count
      this.learnedPatterns[key].usageCount = (this.learnedPatterns[key].usageCount || 0) + 1;
      this.learnedPatterns[key].lastUsedAt = new Date().toISOString();
      this.saveLearnedPatterns();
      return;
    }
    
    // In development phase, auto-verify (you're watching)
    const autoVerify = this.phase === 'development' && this.autoVerifyInDevelopment;
    
    // Store the learned pattern with verification tracking
    this.learnedPatterns[key] = {
      type: fieldType,
      learnedFrom: source,
      learnedAt: new Date().toISOString(),
      ats: this.currentATS,
      company: this.currentCompany,
      originalLabel: field.label,
      originalId: field.id,
      
      // Verification tracking
      verified: autoVerify,
      verifiedAt: autoVerify ? new Date().toISOString() : null,
      verifiedBy: autoVerify ? 'auto_development' : null,
      
      // Usage tracking
      usageCount: 1,
      lastUsedAt: new Date().toISOString(),
    };
    
    const verifyStatus = autoVerify ? '✓ auto-verified' : '⚠ needs review';
    console.log(`   📚 LEARNED: "${field.label}" → ${fieldType} (${verifyStatus})`);
    
    this.saveLearnedPatterns();
  }
  
  // ============================================================================
  // VERIFICATION METHODS
  // ============================================================================
  verifyPattern(key, verifiedBy = 'manual') {
    if (this.learnedPatterns[key]) {
      this.learnedPatterns[key].verified = true;
      this.learnedPatterns[key].verifiedAt = new Date().toISOString();
      this.learnedPatterns[key].verifiedBy = verifiedBy;
      this.saveLearnedPatterns();
      return true;
    }
    return false;
  }
  
  rejectPattern(key) {
    if (this.learnedPatterns[key]) {
      delete this.learnedPatterns[key];
      this.saveLearnedPatterns();
      return true;
    }
    return false;
  }
  
  updatePatternType(key, newType, verifiedBy = 'manual') {
    if (this.learnedPatterns[key]) {
      this.learnedPatterns[key].type = newType;
      this.learnedPatterns[key].verified = true;
      this.learnedPatterns[key].verifiedAt = new Date().toISOString();
      this.learnedPatterns[key].verifiedBy = verifiedBy;
      this.learnedPatterns[key].correctedFrom = this.learnedPatterns[key].type;
      this.saveLearnedPatterns();
      return true;
    }
    return false;
  }
  
  // ============================================================================
  // GET PATTERNS FOR REVIEW
  // ============================================================================
  getUnverifiedPatterns() {
    const unverified = [];
    for (const [key, pattern] of Object.entries(this.learnedPatterns)) {
      if (!pattern.verified) {
        unverified.push({ key, ...pattern });
      }
    }
    // Sort by most recently learned
    return unverified.sort((a, b) => 
      new Date(b.learnedAt) - new Date(a.learnedAt)
    );
  }
  
  getRecentPatterns(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const recent = [];
    for (const [key, pattern] of Object.entries(this.learnedPatterns)) {
      if (new Date(pattern.learnedAt) > cutoff) {
        recent.push({ key, ...pattern });
      }
    }
    return recent.sort((a, b) => 
      new Date(b.learnedAt) - new Date(a.learnedAt)
    );
  }
  
  getAllPatterns() {
    return Object.entries(this.learnedPatterns).map(([key, pattern]) => ({
      key,
      ...pattern,
    }));
  }
  
  // ============================================================================
  // CREATE LEARNED KEY
  // ============================================================================
  createLearnedKey(field) {
    const parts = [];
    
    parts.push(this.currentATS);
    
    if (field.label) {
      const normalizedLabel = field.label
        .toLowerCase()
        .replace(/[*:\s]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 50);
      parts.push(`label:${normalizedLabel}`);
    }
    
    if (field.id) {
      const idParts = field.id.split('--');
      const meaningfulPart = idParts[idParts.length - 1]
        .replace(/[0-9a-f]{8,}/gi, '*')
        .toLowerCase();
      parts.push(`id:${meaningfulPart}`);
    }
    
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
  
  setPhase(phase) {
    this.phase = phase;
    console.log(`[Cache] Phase set to: ${phase}`);
  }
  
  // ============================================================================
  // MAIN LOOKUP METHOD
  // ============================================================================
  lookup(field) {
    // Level 0: Global
    const globalResult = this.checkGlobalPatterns(field);
    if (globalResult) {
      this.stats.level0Hits++;
      return { ...globalResult, cacheLevel: 'global' };
    }
    
    // Level 1: ATS
    const atsResult = this.checkATSPatterns(field);
    if (atsResult) {
      this.stats.level1Hits++;
      return { ...atsResult, cacheLevel: 'ats' };
    }
    
    // Level 2: Question
    const questionResult = this.checkQuestionPatterns(field);
    if (questionResult) {
      this.stats.level2Hits++;
      return { ...questionResult, cacheLevel: 'question' };
    }
    
    // Level 3: Learned
    const learnedResult = this.checkLearnedPatterns(field);
    if (learnedResult) {
      this.stats.level3Hits++;
      if (learnedResult.verified) {
        this.stats.level3VerifiedHits++;
      } else {
        this.stats.level3UnverifiedHits++;
      }
      return { ...learnedResult, cacheLevel: 'learned' };
    }
    
    // Level 4: Runtime
    const runtimeResult = this.checkRuntimeCache(field);
    if (runtimeResult) {
      this.stats.level4Hits++;
      return { ...runtimeResult, cacheLevel: 'runtime' };
    }
    
    this.stats.misses++;
    return null;
  }
  
  // ============================================================================
  // LEVEL CHECKS
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
  
  checkQuestionPatterns(field) {
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
  
  checkLearnedPatterns(field) {
    const key = this.createLearnedKey(field);
    if (!key) return null;
    
    const learned = this.learnedPatterns[key];
    if (learned) {
      // Update usage stats
      learned.usageCount = (learned.usageCount || 0) + 1;
      learned.lastUsedAt = new Date().toISOString();
      this.saveLearnedPatterns();
      
      return { 
        field_type: learned.type, 
        confidence: learned.verified ? 0.95 : 0.85,
        verified: learned.verified,
        learnedFrom: learned.learnedFrom,
      };
    }
    
    return null;
  }
  
  checkRuntimeCache(field) {
    const key = this.createCacheKey(field);
    const cached = this.runtimeCache.get(key);
    if (cached) {
      return { field_type: cached.type, confidence: 0.85 };
    }
    return null;
  }
  
  createCacheKey(field) {
    return `${this.currentATS}:${this.currentCompany}:${field.id || ''}:${field.label || ''}:${field.type || ''}`;
  }
  
  addToRuntimeCache(field, fieldType) {
    const key = this.createCacheKey(field);
    this.runtimeCache.set(key, { type: fieldType, timestamp: Date.now() });
  }
  
  // ============================================================================
  // STATISTICS
  // ============================================================================
  getStats() {
    const total = this.stats.level0Hits + this.stats.level1Hits + 
                  this.stats.level2Hits + this.stats.level3Hits + 
                  this.stats.level4Hits + this.stats.misses;
    const hits = total - this.stats.misses;
    
    const allPatterns = Object.values(this.learnedPatterns);
    const verifiedCount = allPatterns.filter(p => p.verified).length;
    const unverifiedCount = allPatterns.length - verifiedCount;
    
    return {
      ...this.stats,
      totalLookups: total,
      hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0',
      runtimeCacheSize: this.runtimeCache.size,
      learnedPatternsCount: allPatterns.length,
      verifiedPatternsCount: verifiedCount,
      unverifiedPatternsCount: unverifiedCount,
    };
  }
  
  printStats() {
    const stats = this.getStats();
    console.log('\n' + '═'.repeat(65));
    console.log('📦 HIERARCHICAL CACHE v3.1 STATISTICS (With Verification!)');
    console.log('═'.repeat(65));
    console.log(`   Phase: ${this.phase}`);
    console.log(`   ATS: ${this.currentATS} | Company: ${this.currentCompany}`);
    console.log('─'.repeat(65));
    console.log(`   Level 0 (Global Labels):   ${stats.level0Hits} hits`);
    console.log(`   Level 1 (ATS Field IDs):   ${stats.level1Hits} hits`);
    console.log(`   Level 2 (Question Text):   ${stats.level2Hits} hits`);
    console.log(`   Level 3 (Learned):         ${stats.level3Hits} hits`);
    console.log(`      ├── Verified:           ${stats.level3VerifiedHits}`);
    console.log(`      └── Unverified:         ${stats.level3UnverifiedHits}`);
    console.log(`   Level 4 (Runtime):         ${stats.level4Hits} hits`);
    console.log(`   Misses (→ Claude):         ${stats.misses}`);
    console.log('─'.repeat(65));
    console.log(`   Total Hit Rate: ${stats.hitRate}%`);
    console.log('─'.repeat(65));
    console.log(`   Learned Patterns: ${stats.learnedPatternsCount}`);
    console.log(`      ├── ✓ Verified:         ${stats.verifiedPatternsCount}`);
    console.log(`      └── ⚠ Needs Review:     ${stats.unverifiedPatternsCount}`);
    console.log('═'.repeat(65) + '\n');
  }
}

export default HierarchicalCache;
