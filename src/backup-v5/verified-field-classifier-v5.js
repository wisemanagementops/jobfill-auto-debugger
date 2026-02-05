/**
 * Verified Field Classifier v5 - CORRECT DESIGN
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                          THE CORRECT FLOW                                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║   1. IDENTIFY FIELD TYPE                                                  ║
 * ║      "First Name" → first_name                                            ║
 * ║      "Are you a US Citizen?" → citizenship_status                         ║
 * ║                                                                           ║
 * ║   2. GET ANSWER FROM THIS USER'S PROFILE                                  ║
 * ║      first_name → profile.personal.firstName → "Bhanu" or "John"          ║
 * ║      citizenship_status → profile.workAuth.isUSCitizenOrPR → Yes/No       ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * Bug Fixes in v5:
 *   1. Phone extension checked BEFORE phone number
 *   2. Field of study checked BEFORE school
 *   3. Answers ALWAYS come from profile, never cached
 *   4. Element type (dropdown vs textarea) affects matching
 */

import Anthropic from '@anthropic-ai/sdk';
import HierarchicalCache, { detectATS, extractCompany } from './hierarchical-cache-v2.js';

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
  'email', 'phone_number', 'country_phone_code', 'phone_extension',
  
  // Address
  'address_line_1', 'address_line_2', 'city', 'state', 'postal_code', 'country',
  
  // Work Authorization
  'work_authorization', 'work_authorization_indefinite', 'visa_sponsorship',
  'citizenship_status', 'restricted_country_citizen', 'group_d_country_citizen',
  'foreign_permanent_resident',
  
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
    
    // Cache (stores field types only!)
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
      cacheByLevel: { global: 0, ats: 0, question: 0, runtime: 0 },
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
  // CLASSIFY BY FIELD ID
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
    
    const questionText = (field.section || field.label || '').substring(0, 60);
    
    if (CONFIG.verbose) {
      console.log(`\n   📋 Classifying: "${questionText}..."`);
    }
    
    // STEP 1: Check cache for FIELD TYPE
    const cached = this.cache.get(field);
    
    if (cached) {
      this.stats.fromCache++;
      this.stats.cacheByLevel[cached.cacheLevel]++;
      
      // STEP 2: Get ANSWER from profile based on field type
      const answer = this.getAnswerFromProfile(cached.field_type, field);
      
      if (CONFIG.verbose) {
        console.log(`      💾 Cache HIT (${cached.cacheLevel}): ${cached.field_type}`);
        if (answer !== null) {
          console.log(`      💡 Answer from profile: "${answer}"`);
        }
      }
      
      return {
        type: cached.field_type,
        answer: answer,
        confidence: cached.confidence / 100,
        verified: true,
        source: `cache_${cached.cacheLevel}`,
      };
    }
    
    // STEP 3: Try field ID patterns
    const fieldIdResult = this.classifyByFieldId(field);
    if (fieldIdResult) {
      // Save to cache for next time
      this.cache.set(field, { field_type: fieldIdResult.type });
      
      // Get answer from profile
      const answer = this.getAnswerFromProfile(fieldIdResult.type, field);
      
      if (CONFIG.verbose) {
        console.log(`      🔍 Pattern match: ${fieldIdResult.type}`);
        if (answer !== null) {
          console.log(`      💡 Answer from profile: "${answer}"`);
        }
      }
      
      return {
        type: fieldIdResult.type,
        answer: answer,
        confidence: fieldIdResult.confidence,
        verified: true,
        source: 'pattern',
      };
    }
    
    // STEP 4: Call Claude for field type
    if (CONFIG.verbose) {
      console.log(`      🌐 Calling Claude API for verification...`);
    }
    
    const claudeResult = await this.verifyWithClaude(field);
    this.stats.fromClaude++;
    
    // Save to cache
    this.cache.set(field, { field_type: claudeResult.field_type });
    
    // Get answer from profile
    const answer = this.getAnswerFromProfile(claudeResult.field_type, field);
    
    if (CONFIG.verbose) {
      console.log(`      🔄 Claude says: ${claudeResult.field_type}`);
      if (answer !== null) {
        console.log(`      💡 Answer from profile: "${answer}"`);
      }
    }
    
    return {
      type: claudeResult.field_type,
      answer: answer,
      confidence: claudeResult.confidence / 100,
      verified: true,
      source: 'claude_api',
      reasoning: claudeResult.reasoning,
    };
  }
  
  // ============================================================================
  // GET ANSWER FROM PROFILE - The critical function!
  // ============================================================================
  getAnswerFromProfile(fieldType, field = {}) {
    const p = this.profile;
    if (!p) return null;
    
    // Helper for date parts
    const today = new Date();
    const datePart = (field.label || '').toLowerCase();
    
    // =========================================
    // PERSONAL INFORMATION
    // =========================================
    if (fieldType === 'first_name') return p.personal?.firstName;
    if (fieldType === 'last_name') return p.personal?.lastName;
    if (fieldType === 'middle_name') return p.personal?.middleName || '';
    if (fieldType === 'full_name') return `${p.personal?.firstName || ''} ${p.personal?.lastName || ''}`.trim();
    if (fieldType === 'preferred_name') return p.personal?.preferredName || '';
    if (fieldType === 'email') return p.personal?.email;
    if (fieldType === 'phone_number') return p.personal?.phone?.replace(/[\(\)\-\s]/g, '');
    if (fieldType === 'country_phone_code') return '+1';
    if (fieldType === 'phone_extension') return '';  // Most people don't have one!
    
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
    // EDUCATION
    // =========================================
    if (fieldType === 'school') return p.education?.school;
    if (fieldType === 'degree') return p.education?.degree;
    if (fieldType === 'field_of_study') return p.education?.fieldOfStudy;  // FIXED!
    if (fieldType === 'graduation_year') return p.education?.graduationYear;
    if (fieldType === 'gpa') return p.education?.gpa;
    
    // =========================================
    // DOCUMENTS
    // =========================================
    if (fieldType === 'resume_upload') return p.documents?.resumePath;
    if (fieldType === 'cover_letter_upload') return p.documents?.coverLetterPath;
    if (fieldType === 'linkedin') return p.documents?.linkedin;
    if (fieldType === 'website') return p.documents?.website || '';
    if (fieldType === 'portfolio') return p.documents?.portfolio || '';
    
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
    if (fieldType === 'previously_employed') {
      return p.additional?.previouslyEmployed ? 'Yes' : 'No';
    }
    if (fieldType === 'relative_at_company') {
      return p.additional?.hasRelativeAtCompany ? 'Yes' : 'No';
    }
    if (fieldType === 'other_commitments') {
      return p.additional?.hasOtherCommitments ? 'Yes' : 'No';
    }
    if (fieldType === 'restrictive_agreement') {
      return p.additional?.hasRestrictiveAgreement ? 'Yes' : 'No';
    }
    if (fieldType === 'age_verification') {
      return p.additional?.over18 !== false ? 'Yes' : 'No';
    }
    if (fieldType === 'minor_work_permit') {
      return 'N/A';  // Adult applicants
    }
    
    // =========================================
    // EEO
    // =========================================
    if (fieldType === 'gender') return p.eeo?.gender;
    if (fieldType === 'race_ethnicity') return p.eeo?.race;
    if (fieldType === 'veteran_status') return p.eeo?.veteranStatus;
    if (fieldType === 'disability_status') return p.eeo?.disabilityStatus;
    if (fieldType === 'hispanic_latino') return p.eeo?.hispanicLatino || 'No';
    
    // =========================================
    // REFERRAL
    // =========================================
    if (fieldType === 'referral_source') return p.referral?.source || 'LinkedIn';
    
    // =========================================
    // CONSENT / AGREEMENTS
    // =========================================
    if (fieldType === 'terms_agreement') return 'Yes';
    if (fieldType === 'ai_recruitment_consent') return 'Yes';
    if (fieldType === 'future_opportunities_consent') return 'Yes';
    
    // =========================================
    // SIGNATURE DATE
    // =========================================
    if (fieldType === 'signature_date') {
      if (datePart.includes('month')) return String(today.getMonth() + 1);
      if (datePart.includes('day')) return String(today.getDate());
      if (datePart.includes('year')) return String(today.getFullYear());
      return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    }
    
    // =========================================
    // EMPLOYEE ID (blank for external applicants)
    // =========================================
    if (fieldType === 'employee_id') return '';
    
    // =========================================
    // SKILLS (no automatic answer)
    // =========================================
    if (fieldType === 'skills') return null;
    
    // Unknown field type
    return null;
  }
  
  // Alias for backward compatibility
  proposeAnswerFromProfile(fieldType) {
    return this.getAnswerFromProfile(fieldType, {});
  }
  
  // ============================================================================
  // CALL CLAUDE API
  // ============================================================================
  async verifyWithClaude(field) {
    if (!this.client) {
      return { field_type: 'unknown', confidence: 50, reasoning: 'No API key' };
    }
    
    const prompt = this.buildPrompt(field);
    
    try {
      const response = await this.client.messages.create({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          field_type: result.field_type || 'unknown',
          confidence: result.confidence || 80,
          reasoning: result.reasoning || '',
        };
      }
    } catch (error) {
      console.error('[Claude] API error:', error.message);
    }
    
    return { field_type: 'unknown', confidence: 50, reasoning: 'API error' };
  }
  
  buildPrompt(field) {
    const questionText = field.section || field.label || '(no text)';
    const label = field.label || '(no label)';
    const fieldId = field.id || '(no id)';
    const elementType = field.type || 'unknown';
    const options = field.options || [];
    
    return `Classify this job application form field.

FIELD:
- Question/Section: "${questionText.substring(0, 300)}"
- Label: "${label}"
- Field ID: "${fieldId}"
- Element Type: ${elementType}
- Options: ${options.length > 0 ? JSON.stringify(options.slice(0, 10)) : '(text input)'}

AVAILABLE TYPES:
${FIELD_TYPES.join(', ')}

IMPORTANT:
- "countryRegion" in Workday = STATE (not country!)
- "selfIdentifiedDisabilityData--name" = full_name (it's asking for person's name, not disability!)
- If field ID contains "extension" = phone_extension
- If field ID contains "fieldOfStudy" = field_of_study (not school!)
- Textarea asking for explanation ≠ dropdown asking Yes/No

RESPOND IN JSON:
{
  "field_type": "the_correct_type",
  "confidence": 90,
  "reasoning": "Brief explanation"
}`;
  }
  
  // ============================================================================
  // STATISTICS
  // ============================================================================
  getStats() {
    return {
      ...this.stats,
      cache: this.cache.getStats(),
    };
  }
  
  printStats() {
    const stats = this.getStats();
    console.log('\n' + '═'.repeat(60));
    console.log('📊 VERIFIED FIELD CLASSIFIER v5 STATISTICS');
    console.log('═'.repeat(60));
    console.log(`   Total Fields: ${stats.totalFields}`);
    console.log(`   From Cache: ${stats.fromCache}`);
    console.log(`   From Claude: ${stats.fromClaude}`);
    console.log('─'.repeat(60));
    console.log('📦 CACHE BY LEVEL:');
    console.log(`   Global:   ${stats.cacheByLevel.global}`);
    console.log(`   ATS:      ${stats.cacheByLevel.ats}`);
    console.log(`   Question: ${stats.cacheByLevel.question}`);
    console.log(`   Runtime:  ${stats.cacheByLevel.runtime}`);
    console.log('═'.repeat(60) + '\n');
    
    this.cache.printStats();
  }
}

export default VerifiedFieldClassifier;
export { detectATS, extractCompany };
