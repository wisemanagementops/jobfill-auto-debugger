/**
 * Verified Field Classifier v6 - WITH LEARNING!
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                          THE FLOW WITH LEARNING                           ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║   1. CHECK HARDCODED PATTERNS (instant, free)                             ║
 * ║      └── Global labels, ATS field IDs, Question text                      ║
 * ║              ↓ miss                                                       ║
 * ║   2. CHECK LEARNED PATTERNS (instant, free)                               ║
 * ║      └── From learned-patterns.json                                       ║
 * ║              ↓ miss                                                       ║
 * ║   3. CALL CLAUDE API (slow, costs money)                                  ║
 * ║              ↓                                                            ║
 * ║   4. LEARN THE PATTERN (save to learned-patterns.json)                    ║
 * ║      └── Next time anyone sees this field, no API call!                   ║
 * ║                                                                           ║
 * ║   COST SAVINGS:                                                           ║
 * ║   500 users × 500 apps × 10 calls = 2,500,000 calls → ~$500+ API costs    ║
 * ║   With learning: ~500 patterns learned, then FREE forever!                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import Anthropic from '@anthropic-ai/sdk';
import HierarchicalCache, { detectATS, extractCompany } from './hierarchical-cache.js';

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 500,
  temperature: 0,
  verbose: true,
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
  'referral_source', 'skills', 'signature_date', 'employee_id',
  
  // Catch-all
  'unknown',
];

// ============================================================================
// FIELD ID PATTERNS (Order matters! More specific first!)
// ============================================================================
const FIELD_ID_PATTERNS = [
  // Phone - EXTENSION MUST BE FIRST!
  { pattern: /extension/i, type: 'phone_extension' },
  { pattern: /countryPhoneCode/i, type: 'country_phone_code' },
  { pattern: /phoneType/i, type: 'phone_type' },
  { pattern: /phone[-_]?number|phoneNumber/i, type: 'phone_number' },
  
  // Personal
  { pattern: /first[-_]?name|--firstName/i, type: 'first_name' },
  { pattern: /last[-_]?name|--lastName/i, type: 'last_name' },
  { pattern: /middle[-_]?name/i, type: 'middle_name' },
  { pattern: /preferred[-_]?name/i, type: 'preferred_name' },
  { pattern: /^email|--email/i, type: 'email' },
  
  // Address
  { pattern: /addressLine1/i, type: 'address_line_1' },
  { pattern: /addressLine2/i, type: 'address_line_2' },
  { pattern: /--city$/i, type: 'city' },
  { pattern: /countryRegion/i, type: 'state' },  // Workday's state field!
  { pattern: /postalCode/i, type: 'postal_code' },
  
  // Employment
  { pattern: /candidateIsPreviousWorker/i, type: 'previously_employed' },
  
  // Education - FIELD OF STUDY BEFORE SCHOOL!
  { pattern: /fieldOfStudy/i, type: 'field_of_study' },
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
  { pattern: /disabilityStatus/i, type: 'disability_status' },
  { pattern: /employeeId/i, type: 'employee_id' },
  { pattern: /dateSignedOn/i, type: 'signature_date' },
  
  // Other
  { pattern: /source--source/i, type: 'referral_source' },
  { pattern: /skills/i, type: 'skills' },
  { pattern: /acceptTerms/i, type: 'terms_agreement' },
];

// ============================================================================
// VERIFIED FIELD CLASSIFIER CLASS
// ============================================================================
class VerifiedFieldClassifier {
  constructor(options = {}) {
    this.profile = options.profile || null;
    this.stage1Classifier = options.stage1Classifier || null;
    this.stage2Classifier = options.stage2Classifier || null;
    
    // API client
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
    
    // Cache WITH LEARNING!
    this.cache = new HierarchicalCache({
      cacheDir: options.cacheDir || './cache',
    });
    
    // Context
    this.currentATS = 'unknown';
    this.currentCompany = 'unknown';
    
    // Statistics
    this.stats = {
      totalFields: 0,
      fromCache: 0,
      fromClaude: 0,
      patternsLearned: 0,
      cacheByLevel: { global: 0, ats: 0, question: 0, learned: 0, runtime: 0 },
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
  // CLASSIFY BY FIELD ID (Quick pattern check)
  // ============================================================================
  classifyByFieldId(field) {
    const fieldId = field.id || field.name || '';
    
    for (const { pattern, type } of FIELD_ID_PATTERNS) {
      if (pattern.test(fieldId)) {
        return { type, confidence: 0.95, source: 'field_id' };
      }
    }
    return null;
  }
  
  // ============================================================================
  // MAIN CLASSIFICATION METHOD
  // ============================================================================
  async classifyField(field) {
    this.stats.totalFields++;
    
    const label = field.label || field.name || field.id || 'unknown';
    console.log(`\n   📋 Classifying: "${label.substring(0, 60)}..."`);
    
    // Step 1: Check cache (includes hardcoded + learned patterns)
    const cached = this.cache.lookup(field);
    if (cached) {
      this.stats.fromCache++;
      this.stats.cacheByLevel[cached.cacheLevel] = 
        (this.stats.cacheByLevel[cached.cacheLevel] || 0) + 1;
      
      console.log(`      💾 Cache HIT (${cached.cacheLevel}): ${cached.field_type}`);
      
      // Get answer from profile
      const answer = this.getAnswerFromProfile(cached.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      
      return {
        field_type: cached.field_type,
        confidence: cached.confidence,
        source: `cache_${cached.cacheLevel}`,
        answer,
      };
    }
    
    // Step 2: Check field ID patterns
    const idMatch = this.classifyByFieldId(field);
    if (idMatch) {
      this.stats.fromCache++;  // Still counts as "free" since no API call
      console.log(`      🔍 Pattern match: ${idMatch.type}`);
      
      // Add to runtime cache
      this.cache.addToRuntimeCache(field, idMatch.type);
      
      const answer = this.getAnswerFromProfile(idMatch.type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      
      return {
        field_type: idMatch.type,
        confidence: idMatch.confidence,
        source: 'pattern',
        answer,
      };
    }
    
    // Step 3: Call Claude API
    console.log(`      🌐 Calling Claude API for verification...`);
    const claudeResult = await this.callClaudeForVerification(field);
    
    if (claudeResult) {
      this.stats.fromClaude++;
      console.log(`      🔄 Claude says: ${claudeResult.field_type}`);
      
      // LEARN THE PATTERN! (Save to file for future use)
      this.cache.learnPattern(field, claudeResult.field_type, 'claude_api');
      this.stats.patternsLearned++;
      
      // Add to runtime cache too
      this.cache.addToRuntimeCache(field, claudeResult.field_type);
      
      const answer = this.getAnswerFromProfile(claudeResult.field_type, field);
      if (answer !== undefined && answer !== null && answer !== '') {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
      
      return {
        ...claudeResult,
        source: 'claude_api',
        answer,
      };
    }
    
    // Fallback
    return {
      field_type: 'unknown',
      confidence: 0,
      source: 'fallback',
      answer: null,
    };
  }
  
  // ============================================================================
  // CALL CLAUDE API FOR FIELD CLASSIFICATION
  // ============================================================================
  async callClaudeForVerification(field) {
    if (!this.client) {
      console.warn('      ⚠️ No API client configured');
      return null;
    }
    
    const prompt = `Classify this job application form field.

FIELD INFORMATION:
- Label: "${field.label || 'N/A'}"
- ID: "${field.id || 'N/A'}"
- Type: "${field.type || 'N/A'}"
- Options: ${field.options ? JSON.stringify(field.options.slice(0, 10)) : 'N/A'}
- Context: "${(field.section || field.fullText || '').substring(0, 200)}"

VALID FIELD TYPES:
${FIELD_TYPES.join(', ')}

Respond with ONLY the field_type (one of the above), nothing else.`;

    try {
      const response = await this.client.messages.create({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const responseText = response.content[0].text.trim().toLowerCase();
      
      // Find matching field type
      const matchedType = FIELD_TYPES.find(t => 
        responseText.includes(t) || responseText === t
      );
      
      if (matchedType) {
        return {
          field_type: matchedType,
          confidence: 0.95,
        };
      }
    } catch (error) {
      console.warn(`      ⚠️ API error: ${error.message}`);
    }
    
    return null;
  }
  
  // ============================================================================
  // GET ANSWER FROM PROFILE (The core logic!)
  // ============================================================================
  getAnswerFromProfile(fieldType, field = {}) {
    const p = this.profile;
    if (!p) return null;
    
    // =========================================
    // PERSONAL INFORMATION
    // =========================================
    if (fieldType === 'first_name') return p.personal?.firstName;
    if (fieldType === 'last_name') return p.personal?.lastName;
    if (fieldType === 'middle_name') return p.personal?.middleName || '';
    if (fieldType === 'full_name') return `${p.personal?.firstName || ''} ${p.personal?.lastName || ''}`.trim();
    if (fieldType === 'preferred_name') return p.personal?.preferredName || '';
    if (fieldType === 'email') return p.personal?.email;
    
    // =========================================
    // PHONE
    // =========================================
    if (fieldType === 'phone_number') {
      const phone = p.personal?.phone || '';
      return phone.replace(/\D/g, '');  // Remove non-digits
    }
    if (fieldType === 'country_phone_code') return p.personal?.countryPhoneCode || '+1';
    if (fieldType === 'phone_extension') return '';  // Most people don't have one
    if (fieldType === 'phone_type') return p.personal?.phoneType || 'Mobile';
    
    // =========================================
    // ADDRESS
    // =========================================
    if (fieldType === 'address_line_1') return p.address?.line1;
    if (fieldType === 'address_line_2') return p.address?.line2 || '';
    if (fieldType === 'city') return p.address?.city;
    if (fieldType === 'state') return p.address?.state;
    if (fieldType === 'postal_code') return p.address?.zipCode;
    if (fieldType === 'country') return p.address?.country || 'United States of America';
    
    // =========================================
    // WORK AUTHORIZATION - Logic based!
    // =========================================
    if (fieldType === 'work_authorization') {
      // "Are you authorized to work in the US?" - H1B CAN work, so Yes
      return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    }
    if (fieldType === 'work_authorization_indefinite') {
      // "Are you authorized INDEFINITELY?" - H1B is NOT indefinite!
      // Only US Citizens and Green Card holders = Yes
      // H1B, L1, F1, etc. = No (they have expiration dates)
      return p.workAuth?.isUSCitizenOrPR ? 'Yes' : 'No';
    }
    if (fieldType === 'visa_sponsorship') {
      // "Will you NEED sponsorship?" - H1B = Yes (needs company to sponsor)
      return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    }
    if (fieldType === 'citizenship_status') {
      // "Are you a US Citizen or Permanent Resident?"
      return p.workAuth?.isUSCitizenOrPR ? 'Yes' : 'No';
    }
    if (fieldType === 'citizenship_country_text') {
      // Textarea asking for country of citizenship
      return p.personal?.citizenship || 'India';
    }
    if (fieldType === 'restricted_country_citizen') {
      // Cuba, Iran, North Korea, Syria
      return 'No';  // Most applicants can say No
    }
    if (fieldType === 'group_d_country_citizen') {
      // Armenia, Azerbaijan, Belarus, etc.
      return 'No';  // India is not Group D
    }
    if (fieldType === 'foreign_permanent_resident') {
      return 'No';  // "Are you a permanent resident of another country?"
    }
    
    // =========================================
    // EMPLOYMENT
    // =========================================
    if (fieldType === 'previously_employed') return p.additional?.previouslyEmployed ? 'Yes' : 'No';
    if (fieldType === 'relative_at_company') return p.additional?.hasRelativeAtCompany ? 'Yes' : 'No';
    if (fieldType === 'other_commitments') return p.additional?.hasOtherCommitments ? 'Yes' : 'No';
    if (fieldType === 'restrictive_agreement') return p.additional?.hasRestrictiveAgreement ? 'Yes' : 'No';
    if (fieldType === 'desired_salary') return p.employment?.desiredSalary || '';
    if (fieldType === 'available_start_date') return p.employment?.availableStartDate || '';
    if (fieldType === 'years_of_experience') return p.employment?.yearsOfExperience || '';
    
    // =========================================
    // EDUCATION
    // =========================================
    if (fieldType === 'school') return p.education?.school;
    if (fieldType === 'degree') return p.education?.degree;
    if (fieldType === 'field_of_study') return p.education?.fieldOfStudy;
    if (fieldType === 'graduation_year') return p.education?.graduationYear;
    if (fieldType === 'gpa') return p.education?.gpa || '';
    
    // =========================================
    // DOCUMENTS
    // =========================================
    if (fieldType === 'resume_upload') return p.documents?.resumePath;
    if (fieldType === 'cover_letter_upload') return p.documents?.coverLetterPath || '';
    if (fieldType === 'linkedin') return p.documents?.linkedin || '';
    if (fieldType === 'website') return p.documents?.website || '';
    if (fieldType === 'portfolio') return p.documents?.portfolio || '';
    
    // =========================================
    // EEO / DEMOGRAPHICS
    // =========================================
    if (fieldType === 'gender') return p.eeo?.gender;
    if (fieldType === 'race_ethnicity') return p.eeo?.race;
    if (fieldType === 'hispanic_latino') return p.eeo?.hispanicLatino || 'No';
    if (fieldType === 'veteran_status') return p.eeo?.veteranStatus;
    if (fieldType === 'disability_status') return p.eeo?.disabilityStatus;
    
    // =========================================
    // CONSENT / AGREEMENTS
    // =========================================
    if (fieldType === 'terms_agreement') return 'Yes';
    if (fieldType === 'ai_recruitment_consent') return 'Yes';
    if (fieldType === 'future_opportunities_consent') return 'Yes';
    if (fieldType === 'age_verification') return p.additional?.over18 !== false ? 'Yes' : 'No';
    if (fieldType === 'minor_work_permit') return 'No';  // Assuming adult
    
    // =========================================
    // REFERRAL
    // =========================================
    if (fieldType === 'referral_source') return p.referral?.source || 'LinkedIn';
    
    // =========================================
    // SIGNATURE / OTHER
    // =========================================
    if (fieldType === 'signature_date') {
      const today = new Date();
      // Return appropriate part based on field label
      const label = (field.label || '').toLowerCase();
      if (label.includes('month') || label === 'mm') return String(today.getMonth() + 1);
      if (label.includes('day') || label === 'dd') return String(today.getDate());
      if (label.includes('year') || label === 'yyyy') return String(today.getFullYear());
      return today.toLocaleDateString('en-US');
    }
    if (fieldType === 'employee_id') return '';  // Not an employee yet
    if (fieldType === 'skills') return null;  // Complex, handle separately
    
    // Unknown
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
      results.push({
        field,
        ...result,
      });
    }
    
    return results;
  }
  
  // ============================================================================
  // PRINT STATISTICS
  // ============================================================================
  printStats() {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 VERIFIED FIELD CLASSIFIER v6 STATISTICS (WITH LEARNING!)');
    console.log('═'.repeat(60));
    console.log(`   Total Fields: ${this.stats.totalFields}`);
    console.log(`   From Cache: ${this.stats.fromCache}`);
    console.log(`   From Claude: ${this.stats.fromClaude}`);
    console.log(`   Patterns Learned (NEW!): ${this.stats.patternsLearned}`);
    console.log('─'.repeat(60));
    console.log('📦 CACHE BY LEVEL:');
    Object.entries(this.stats.cacheByLevel).forEach(([level, count]) => {
      if (count > 0) {
        const levelName = level.charAt(0).toUpperCase() + level.slice(1);
        console.log(`   ${levelName}:   ${count}`);
      }
    });
    console.log('═'.repeat(60) + '\n');
    
    // Also print cache stats
    this.cache.printStats();
  }
  
  // ============================================================================
  // GET LEARNED PATTERNS COUNT
  // ============================================================================
  getLearnedPatternsCount() {
    return Object.keys(this.cache.learnedPatterns).length;
  }
}

export default VerifiedFieldClassifier;
export { VerifiedFieldClassifier, FIELD_TYPES };
