// ============================================
// AI-POWERED FORM FILLER
// TWO-STAGE CLASSIFICATION:
//   Stage 1: Zero-Shot (DeBERTa) - 45% threshold
//   Stage 2: Semantic Similarity (BGE) - 60% threshold (fallback)
// ============================================

import ZeroShotFieldClassifier from './zero-shot-classifier.js';
import SemanticSimilarityClassifier from './semantic-similarity.js';
import { WorkdayPlatform } from './platforms/workday.js';

// Classification thresholds
const STAGE1_THRESHOLD = 0.45;  // 45% - if below, use Stage 2
const STAGE2_THRESHOLD = 0.60;  // 60% - minimum for Stage 2 match

// ============================================
// DATE CONTEXT TYPES
// ============================================
const DATE_CONTEXTS = {
  DATE_OF_BIRTH: 'date_of_birth',
  GRADUATION_DATE: 'graduation_date',
  EMPLOYMENT_START: 'employment_start_date',
  EMPLOYMENT_END: 'employment_end_date',
  LICENSE_ISSUE: 'license_issue_date',
  LICENSE_EXPIRY: 'license_expiry_date',
  CERTIFICATE_ISSUE: 'certificate_issue_date',
  CERTIFICATE_EXPIRY: 'certificate_expiry_date',
  AVAILABLE_START: 'available_start_date',
  SIGNATURE_DATE: 'signature_date',
  UNKNOWN: 'unknown_date'
};

export class AIFormFiller {
  constructor(page, profile) {
    this.page = page;
    this.profile = profile;
    this.stage1Classifier = new ZeroShotFieldClassifier();
    this.stage2Classifier = new SemanticSimilarityClassifier();
    this.filled = 0;
    this.failed = 0;
    this.skipped = 0;
    this.results = [];
    // Use Workday platform's proven fill methods
    this.platform = WorkdayPlatform;
    // For backward compatibility
    this.classifier = this.stage1Classifier;
  }

  // ============================================
  // COMPREHENSIVE DATE CONTEXT DETECTION
  // ============================================
  // This method analyzes multiple signals to determine what type of date is being asked:
  // 1. Field label/ID - Direct hints like "Date of Birth", "Start Date"
  // 2. Section header - "Education", "Work Experience", "Disability Self-ID"
  // 3. Surrounding fields - What other fields are nearby?
  // 4. Page text/paragraphs - Any instructional text on the page
  // ============================================
  detectDateContext(field, sectionText, allFields = []) {
    const labelLower = (field.label || '').toLowerCase();
    const idLower = (field.id || '').toLowerCase();
    const sectionLower = (sectionText || '').toLowerCase();
    const contextLower = (field.fullText || field.section || '').toLowerCase();
    
    // Combine all text for comprehensive search
    const allText = `${labelLower} ${idLower} ${sectionLower} ${contextLower}`;
    
    console.log(`      🔍 Date Context Analysis:`);
    console.log(`         Field: "${field.label}" (id: ${field.id})`);
    console.log(`         Section: "${(sectionText || '').substring(0, 100)}..."`);
    
    // ========== PRIORITY 1: DIRECT FIELD LABEL/ID HINTS ==========
    // These are explicit and should take precedence
    
    // Date of Birth
    if (labelLower.includes('birth') || labelLower.includes('dob') || labelLower === 'birthday' ||
        idLower.includes('birth') || idLower.includes('dob') ||
        allText.includes('date of birth') || allText.includes('born on')) {
      console.log(`      🗓️ Date Context: DATE OF BIRTH (direct match)`);
      return DATE_CONTEXTS.DATE_OF_BIRTH;
    }
    
    // Graduation Date (explicit)
    if (labelLower.includes('graduation') || labelLower.includes('graduated') ||
        labelLower.includes('completion date') || labelLower.includes('degree date') ||
        idLower.includes('graduation') || idLower.includes('graddate')) {
      console.log(`      🗓️ Date Context: GRADUATION DATE (direct match)`);
      return DATE_CONTEXTS.GRADUATION_DATE;
    }
    
    // Start Date (explicit in label)
    if ((labelLower.includes('start date') || labelLower.includes('from date') ||
         labelLower.includes('begin date') || labelLower.includes('joined date') ||
         labelLower === 'start' || labelLower === 'from') &&
        !labelLower.includes('available')) {
      // Check if employment or education
      if (this.isEducationContext(allText, sectionLower, allFields, field)) {
        console.log(`      🗓️ Date Context: GRADUATION DATE (start in education)`);
        return DATE_CONTEXTS.GRADUATION_DATE;
      }
      console.log(`      🗓️ Date Context: EMPLOYMENT START (direct match)`);
      return DATE_CONTEXTS.EMPLOYMENT_START;
    }
    
    // End Date (explicit in label)
    if (labelLower.includes('end date') || labelLower.includes('to date') ||
        labelLower.includes('through date') || labelLower.includes('left date') ||
        labelLower === 'end' || labelLower === 'to' || labelLower === 'through') {
      console.log(`      🗓️ Date Context: EMPLOYMENT END (direct match)`);
      return DATE_CONTEXTS.EMPLOYMENT_END;
    }
    
    // Available Start Date
    if ((labelLower.includes('available') || labelLower.includes('availability')) &&
        (labelLower.includes('start') || labelLower.includes('date') || labelLower.includes('begin'))) {
      console.log(`      🗓️ Date Context: AVAILABLE START DATE (direct match)`);
      return DATE_CONTEXTS.AVAILABLE_START;
    }
    if (allText.includes('when can you start') || allText.includes('earliest start') ||
        allText.includes('ready to start') || allText.includes('able to begin')) {
      console.log(`      🗓️ Date Context: AVAILABLE START DATE (question match)`);
      return DATE_CONTEXTS.AVAILABLE_START;
    }
    
    // License/Certificate Issue Date
    if ((labelLower.includes('issue') || labelLower.includes('issued') || 
         labelLower.includes('effective') || labelLower.includes('granted')) &&
        (allText.includes('license') || allText.includes('certification') || allText.includes('certificate'))) {
      if (allText.includes('certif')) {
        console.log(`      🗓️ Date Context: CERTIFICATE ISSUE DATE (direct match)`);
        return DATE_CONTEXTS.CERTIFICATE_ISSUE;
      }
      console.log(`      🗓️ Date Context: LICENSE ISSUE DATE (direct match)`);
      return DATE_CONTEXTS.LICENSE_ISSUE;
    }
    
    // License/Certificate Expiry Date
    if ((labelLower.includes('expir') || labelLower.includes('valid until') ||
         labelLower.includes('renewal') || labelLower.includes('expires')) &&
        (allText.includes('license') || allText.includes('certification') || allText.includes('certificate'))) {
      if (allText.includes('certif')) {
        console.log(`      🗓️ Date Context: CERTIFICATE EXPIRY DATE (direct match)`);
        return DATE_CONTEXTS.CERTIFICATE_EXPIRY;
      }
      console.log(`      🗓️ Date Context: LICENSE EXPIRY DATE (direct match)`);
      return DATE_CONTEXTS.LICENSE_EXPIRY;
    }
    
    // Signature Date (explicit)
    if (idLower.includes('datesignedon') || idLower.includes('signaturedate') ||
        labelLower.includes('signature date') || labelLower.includes('date signed') ||
        allText.includes('today\'s date') || allText.includes('sign and date')) {
      console.log(`      🗓️ Date Context: SIGNATURE DATE (direct match)`);
      return DATE_CONTEXTS.SIGNATURE_DATE;
    }
    
    // ========== PRIORITY 2: SECTION-BASED DETECTION ==========
    // Look at the section/page context
    
    // Disability/EEO/Self-ID forms - always signature date (today)
    if (sectionLower.includes('disability') || sectionLower.includes('self-id') ||
        sectionLower.includes('self id') || sectionLower.includes('eeo') ||
        sectionLower.includes('equal employment') || sectionLower.includes('voluntary') ||
        idLower.includes('disability') || idLower.includes('selfid')) {
      console.log(`      🗓️ Date Context: SIGNATURE DATE (disability/EEO section)`);
      return DATE_CONTEXTS.SIGNATURE_DATE;
    }
    
    // Education section
    if (this.isEducationContext(allText, sectionLower, allFields, field)) {
      console.log(`      🗓️ Date Context: GRADUATION DATE (education section)`);
      return DATE_CONTEXTS.GRADUATION_DATE;
    }
    
    // Work Experience section
    if (this.isWorkExperienceContext(allText, sectionLower, allFields, field)) {
      // Determine if start or end based on additional signals
      const startEnd = this.detectStartOrEnd(field, allFields);
      if (startEnd === 'end') {
        console.log(`      🗓️ Date Context: EMPLOYMENT END (work section + position)`);
        return DATE_CONTEXTS.EMPLOYMENT_END;
      }
      console.log(`      🗓️ Date Context: EMPLOYMENT START (work section)`);
      return DATE_CONTEXTS.EMPLOYMENT_START;
    }
    
    // License/Certification section
    if (sectionLower.includes('license') || sectionLower.includes('certification') ||
        sectionLower.includes('certificate') || idLower.includes('license') ||
        idLower.includes('certif')) {
      // Determine issue or expiry
      if (labelLower.includes('expir') || labelLower.includes('end') || 
          idLower.includes('expir') || idLower.includes('end')) {
        console.log(`      🗓️ Date Context: LICENSE EXPIRY (license section + hints)`);
        return DATE_CONTEXTS.LICENSE_EXPIRY;
      }
      console.log(`      🗓️ Date Context: LICENSE ISSUE (license section)`);
      return DATE_CONTEXTS.LICENSE_ISSUE;
    }
    
    // ========== PRIORITY 3: LOOK AT SURROUNDING FIELDS ==========
    const fieldIndex = allFields.findIndex(f => f.id === field.id || f.selector === field.selector);
    console.log(`         Field index: ${fieldIndex} of ${allFields.length}`);
    
    if (fieldIndex >= 0) {
      // Look at previous 5 fields for context clues
      const lookbackCount = 5;
      for (let i = Math.max(0, fieldIndex - lookbackCount); i < fieldIndex; i++) {
        const prevField = allFields[i];
        const prevLabel = (prevField.label || '').toLowerCase();
        const prevId = (prevField.id || '').toLowerCase();
        
        console.log(`         Checking prev field [${i}]: "${prevField.label}"`);
        
        // Education context from nearby fields
        if (prevLabel.includes('school') || prevLabel.includes('university') ||
            prevLabel.includes('college') || prevLabel.includes('degree') ||
            prevLabel.includes('field of study') || prevLabel.includes('major') ||
            prevId.includes('school') || prevId.includes('education') || prevId.includes('degree')) {
          console.log(`      🗓️ Date Context: GRADUATION DATE (nearby education field: "${prevField.label}")`);
          return DATE_CONTEXTS.GRADUATION_DATE;
        }
        
        // Work experience context from nearby fields
        if (prevLabel.includes('company') || prevLabel.includes('employer') ||
            prevLabel.includes('organization') || prevLabel.includes('job title') ||
            prevLabel.includes('position') || prevLabel.includes('role') ||
            prevId.includes('company') || prevId.includes('employer') ||
            prevId.includes('work') || prevId.includes('employment')) {
          // Determine start or end
          const startEnd = this.detectStartOrEnd(field, allFields);
          if (startEnd === 'end') {
            console.log(`      🗓️ Date Context: EMPLOYMENT END (nearby work field: "${prevField.label}")`);
            return DATE_CONTEXTS.EMPLOYMENT_END;
          }
          console.log(`      🗓️ Date Context: EMPLOYMENT START (nearby work field: "${prevField.label}")`);
          return DATE_CONTEXTS.EMPLOYMENT_START;
        }
        
        // Signature/name context (for disability forms)
        if ((prevLabel === 'name*' || prevLabel === 'name' || prevLabel.includes('signature')) &&
            (sectionLower.includes('disability') || sectionLower.includes('self'))) {
          console.log(`      🗓️ Date Context: SIGNATURE DATE (nearby signature field)`);
          return DATE_CONTEXTS.SIGNATURE_DATE;
        }
      }
      
      // Also look at next few fields (sometimes date comes before the entity)
      const lookaheadCount = 3;
      for (let i = fieldIndex + 1; i < Math.min(allFields.length, fieldIndex + lookaheadCount + 1); i++) {
        const nextField = allFields[i];
        const nextLabel = (nextField.label || '').toLowerCase();
        const nextId = (nextField.id || '').toLowerCase();
        
        // If there's a school field coming up, this might be a date related to education
        if (nextLabel.includes('school') || nextLabel.includes('university') ||
            nextId.includes('school') || nextId.includes('education')) {
          console.log(`      🗓️ Date Context: GRADUATION DATE (upcoming education field)`);
          return DATE_CONTEXTS.GRADUATION_DATE;
        }
      }
    }
    
    // ========== PRIORITY 4: PAGE-LEVEL PATTERNS ==========
    // Look for common page patterns
    if (allText.includes('please sign') || allText.includes('your signature') ||
        allText.includes('by signing') || allText.includes('e-signature')) {
      console.log(`      🗓️ Date Context: SIGNATURE DATE (page signature pattern)`);
      return DATE_CONTEXTS.SIGNATURE_DATE;
    }
    
    // Personal information section often has DOB
    if ((sectionLower.includes('personal info') || sectionLower.includes('personal details') ||
         sectionLower.includes('about you')) && 
        (labelLower.includes('date') || labelLower === 'month' || labelLower === 'day' || labelLower === 'year')) {
      // Check if there are other personal fields nearby
      const hasPersonalFields = allFields.some(f => {
        const fl = (f.label || '').toLowerCase();
        return fl.includes('first name') || fl.includes('last name') || fl.includes('email');
      });
      if (hasPersonalFields) {
        console.log(`      🗓️ Date Context: DATE OF BIRTH (personal info section)`);
        return DATE_CONTEXTS.DATE_OF_BIRTH;
      }
    }
    
    // ========== DEFAULT ==========
    // If we can't determine context, default to signature date (today)
    // This is safest as it doesn't require profile data
    console.log(`      🗓️ Date Context: UNKNOWN → defaulting to SIGNATURE DATE (today)`);
    return DATE_CONTEXTS.SIGNATURE_DATE;
  }
  
  // Helper: Check if we're in an education context
  isEducationContext(allText, sectionLower, allFields, currentField) {
    // Direct section match
    if (sectionLower.includes('education') || sectionLower.includes('academic') ||
        sectionLower.includes('school') || sectionLower.includes('university') ||
        sectionLower.includes('degree') || sectionLower.includes('qualification')) {
      return true;
    }
    
    // ID contains education hints
    const idLower = (currentField.id || '').toLowerCase();
    if (idLower.includes('education') || idLower.includes('school') || 
        idLower.includes('degree') || idLower.includes('academ')) {
      return true;
    }
    
    // Check for education-related fields nearby
    const fieldIndex = allFields.findIndex(f => f.id === currentField.id);
    if (fieldIndex >= 0) {
      for (let i = Math.max(0, fieldIndex - 5); i < Math.min(allFields.length, fieldIndex + 3); i++) {
        if (i === fieldIndex) continue;
        const f = allFields[i];
        const fl = (f.label || '').toLowerCase();
        const fid = (f.id || '').toLowerCase();
        if (fl.includes('school') || fl.includes('university') || fl.includes('degree') ||
            fl.includes('field of study') || fl.includes('major') || fl.includes('gpa') ||
            fid.includes('school') || fid.includes('education')) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // Helper: Check if we're in a work experience context
  isWorkExperienceContext(allText, sectionLower, allFields, currentField) {
    // Direct section match
    if (sectionLower.includes('work') || sectionLower.includes('experience') ||
        sectionLower.includes('employment') || sectionLower.includes('job history') ||
        sectionLower.includes('professional') || sectionLower.includes('career')) {
      return true;
    }
    
    // ID contains work hints
    const idLower = (currentField.id || '').toLowerCase();
    if (idLower.includes('work') || idLower.includes('employment') || 
        idLower.includes('experience') || idLower.includes('job')) {
      return true;
    }
    
    // Check for work-related fields nearby
    const fieldIndex = allFields.findIndex(f => f.id === currentField.id);
    if (fieldIndex >= 0) {
      for (let i = Math.max(0, fieldIndex - 5); i < Math.min(allFields.length, fieldIndex + 3); i++) {
        if (i === fieldIndex) continue;
        const f = allFields[i];
        const fl = (f.label || '').toLowerCase();
        const fid = (f.id || '').toLowerCase();
        if (fl.includes('company') || fl.includes('employer') || fl.includes('job title') ||
            fl.includes('position') || fl.includes('role') || fl.includes('responsibilities') ||
            fid.includes('company') || fid.includes('employer') || fid.includes('work')) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // Helper: Determine if this is a start or end date based on position and labels
  detectStartOrEnd(field, allFields) {
    const labelLower = (field.label || '').toLowerCase();
    const idLower = (field.id || '').toLowerCase();
    
    // Direct label hints
    if (labelLower.includes('end') || labelLower.includes(' to') || labelLower.includes('through') ||
        labelLower.includes('left') || labelLower.includes('until') ||
        idLower.includes('end') || idLower.includes('todate')) {
      return 'end';
    }
    if (labelLower.includes('start') || labelLower.includes('from') || labelLower.includes('begin') ||
        labelLower.includes('join') || idLower.includes('start') || idLower.includes('from')) {
      return 'start';
    }
    
    // Look at field position relative to other date fields
    // In work history, usually: Company, Title, Start Date, End Date
    // So if we already passed a date field, this is likely the end date
    const fieldIndex = allFields.findIndex(f => f.id === field.id);
    if (fieldIndex > 0) {
      // Check if there's already a date field before this one in the same "group"
      let foundStartDate = false;
      for (let i = fieldIndex - 1; i >= Math.max(0, fieldIndex - 4); i--) {
        const prevField = allFields[i];
        const prevLabel = (prevField.label || '').toLowerCase();
        const prevId = (prevField.id || '').toLowerCase();
        
        // If we hit a company/employer field, stop looking
        if (prevLabel.includes('company') || prevLabel.includes('employer') ||
            prevId.includes('company') || prevId.includes('employer')) {
          break;
        }
        
        // If there's another date-like field before us
        if (prevLabel === 'month' || prevLabel === 'day' || prevLabel === 'year' ||
            prevLabel.includes('date') || prevLabel.includes('start') || prevLabel.includes('from')) {
          foundStartDate = true;
          break;
        }
      }
      
      if (foundStartDate) {
        return 'end';
      }
    }
    
    return 'start';  // Default to start date
  }
  
  // ============================================
  // GET DATE VALUE BASED ON CONTEXT
  // ============================================
  getDateValue(dateContext, field, profile) {
    const p = profile;
    const fieldLabel = (field?.label || '').toLowerCase();
    const datePart = field?.datePart || fieldLabel;
    const today = new Date();
    
    // Helper to extract date part (month, day, year) from a date
    const extractDatePart = (dateValue, part) => {
      if (!dateValue) return null;
      
      // If it's already a specific part value
      if (typeof dateValue === 'number') return String(dateValue);
      if (typeof dateValue === 'string' && dateValue.length <= 4) return dateValue;
      
      // Try to parse date
      let date;
      if (dateValue instanceof Date) {
        date = dateValue;
      } else if (typeof dateValue === 'string') {
        // Handle various formats: YYYY-MM-DD, MM/DD/YYYY, etc.
        date = new Date(dateValue);
        if (isNaN(date.getTime())) {
          // Try MM/DD/YYYY
          const parts = dateValue.split(/[\/\-]/);
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              // YYYY-MM-DD
              date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            } else {
              // MM/DD/YYYY
              date = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
            }
          }
        }
      }
      
      if (date && !isNaN(date.getTime())) {
        const partLower = (part || '').toLowerCase();
        if (partLower === 'month' || partLower.includes('month')) {
          return String(date.getMonth() + 1);  // 1-12
        }
        if (partLower === 'day' || partLower.includes('day')) {
          return String(date.getDate());  // 1-31
        }
        if (partLower === 'year' || partLower.includes('year')) {
          return String(date.getFullYear());  // YYYY
        }
        // Return full date
        return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
      }
      
      return dateValue;  // Return as-is if can't parse
    };
    
    // Format today's date for the requested part
    const getTodayPart = (part) => {
      const partLower = (part || '').toLowerCase();
      if (partLower === 'month' || partLower.includes('month')) {
        return String(today.getMonth() + 1);
      }
      if (partLower === 'day' || partLower.includes('day')) {
        return String(today.getDate());
      }
      if (partLower === 'year' || partLower.includes('year')) {
        return String(today.getFullYear());
      }
      return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    };
    
    switch (dateContext) {
      case DATE_CONTEXTS.DATE_OF_BIRTH:
        if (p.personal?.dateOfBirth) {
          return extractDatePart(p.personal.dateOfBirth, datePart);
        }
        console.log(`         ⚠️ Date of birth not in profile - skipping`);
        return null;  // Don't guess DOB
        
      case DATE_CONTEXTS.GRADUATION_DATE:
        // Try graduation date, fall back to year
        if (p.education?.graduationDate) {
          return extractDatePart(p.education.graduationDate, datePart);
        }
        if (p.education?.graduationYear) {
          // If we only have year, return it for year field, null otherwise
          if (datePart.includes('year')) {
            return String(p.education.graduationYear);
          }
          // For month/day, use May (common graduation month)
          if (datePart.includes('month')) return '5';
          if (datePart.includes('day')) return '15';
          return `5/15/${p.education.graduationYear}`;
        }
        console.log(`         ⚠️ Graduation date not in profile - skipping`);
        return null;
        
      case DATE_CONTEXTS.EMPLOYMENT_START:
        // Check work history
        if (p.workHistory && p.workHistory.length > 0) {
          const latestJob = p.workHistory[0];  // Assuming sorted newest first
          if (latestJob.startDate) {
            return extractDatePart(latestJob.startDate, datePart);
          }
        }
        console.log(`         ⚠️ Employment start date not in profile - skipping`);
        return null;
        
      case DATE_CONTEXTS.EMPLOYMENT_END:
        // Check work history
        if (p.workHistory && p.workHistory.length > 0) {
          const latestJob = p.workHistory[0];
          if (latestJob.endDate) {
            // Handle "Present" or "Current"
            if (latestJob.endDate.toLowerCase() === 'present' || 
                latestJob.endDate.toLowerCase() === 'current') {
              // Return today's date for "present"
              return getTodayPart(datePart);
            }
            return extractDatePart(latestJob.endDate, datePart);
          }
          // If currently employed, return today's date
          if (latestJob.currentlyEmployed || p.additional?.currentlyEmployed) {
            return getTodayPart(datePart);
          }
        }
        console.log(`         ⚠️ Employment end date not in profile - skipping`);
        return null;
        
      case DATE_CONTEXTS.LICENSE_ISSUE:
      case DATE_CONTEXTS.CERTIFICATE_ISSUE:
        if (p.licenses && p.licenses.length > 0 && p.licenses[0].issueDate) {
          return extractDatePart(p.licenses[0].issueDate, datePart);
        }
        console.log(`         ⚠️ License issue date not in profile - skipping`);
        return null;
        
      case DATE_CONTEXTS.LICENSE_EXPIRY:
      case DATE_CONTEXTS.CERTIFICATE_EXPIRY:
        if (p.licenses && p.licenses.length > 0 && p.licenses[0].expiryDate) {
          return extractDatePart(p.licenses[0].expiryDate, datePart);
        }
        console.log(`         ⚠️ License expiry date not in profile - skipping`);
        return null;
        
      case DATE_CONTEXTS.AVAILABLE_START:
        if (p.employment?.availableStartDate) {
          const avail = p.employment.availableStartDate.toLowerCase();
          // Handle text values
          if (avail === 'immediately' || avail === 'now' || avail === 'asap') {
            return getTodayPart(datePart);
          }
          if (avail.includes('week')) {
            // "2 weeks" - add 14 days to today
            const weeks = parseInt(avail) || 2;
            const futureDate = new Date(today.getTime() + (weeks * 7 * 24 * 60 * 60 * 1000));
            return extractDatePart(futureDate, datePart);
          }
          if (avail.includes('month')) {
            // "1 month" - add 30 days
            const months = parseInt(avail) || 1;
            const futureDate = new Date(today.getTime() + (months * 30 * 24 * 60 * 60 * 1000));
            return extractDatePart(futureDate, datePart);
          }
          // Try to parse as date
          return extractDatePart(p.employment.availableStartDate, datePart);
        }
        // Default to 2 weeks from today
        const twoWeeksOut = new Date(today.getTime() + (14 * 24 * 60 * 60 * 1000));
        return extractDatePart(twoWeeksOut, datePart);
        
      case DATE_CONTEXTS.SIGNATURE_DATE:
      case DATE_CONTEXTS.UNKNOWN:
      default:
        // Signature date is always today
        return getTodayPart(datePart);
    }
  }

  async fillAllFields() {
    console.log('🤖 [AI-FormFiller] Starting TWO-STAGE AI form analysis...\n');
    
    // Step 1: Load Stage 1 model (Zero-Shot)
    console.log('📦 Loading Stage 1 model (Zero-Shot DeBERTa)...');
    await this.stage1Classifier.loadModel();
    console.log('✅ Stage 1 ready\n');

    // Step 2: Discover all interactive fields on the page
    console.log('🔍 Discovering form fields...');
    const fields = await this.discoverFields();
    console.log(`   Found ${fields.length} interactive fields\n`);

    if (fields.length === 0) {
      console.log('⚠️ No fields found on this page');
      return { filled: 0, failed: 0, skipped: 0 };
    }

    // Step 3: Classify each field with AI
    console.log('🧠 Classifying fields with AI...\n');
    const classifications = await this.classifyAllFields(fields);

    // Step 4: Fill each field based on classification
    console.log('\n📝 Filling fields based on AI understanding...\n');
    await this.fillClassifiedFields(classifications);

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 RESULTS SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Filled:  ${this.filled}`);
    console.log(`❌ Failed:  ${this.failed}`);
    console.log(`⏭️  Skipped: ${this.skipped}`);
    console.log('═'.repeat(50));

    return {
      filled: this.filled,
      failed: this.failed,
      skipped: this.skipped,
      details: this.results
    };
  }

  // ============================================
  // STEP 1: DISCOVER ALL FIELDS
  // ============================================
  async discoverFields() {
    const rawFields = await this.page.evaluate(() => {
      const fields = [];
      
      // Fields to SKIP - these are UI elements, not form fields
      const SKIP_PATTERNS = [
        /selector/i,
        /button$/i,
        /^lang/i,
        /^setting/i,
        /^nav/i,
        /^menu/i,
        /^header/i,
        /^footer/i,
        /^logo/i,
        /^icon/i
      ];
      
      function shouldSkip(label, id, name) {
        const text = `${label} ${id} ${name}`.toLowerCase();
        return SKIP_PATTERNS.some(p => p.test(text));
      }
      
      // Helper to get visible label text
      function getLabel(el) {
        // Try aria-label
        if (el.getAttribute('aria-label')) {
          return el.getAttribute('aria-label').replace(/required/gi, '').trim();
        }
        
        // Try associated label
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) return label.textContent.trim();
        }
        
        // Try parent label
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
        
        // Try nearby label (previous sibling or parent's previous sibling)
        let prev = el.previousElementSibling;
        while (prev) {
          if (prev.tagName === 'LABEL' || prev.querySelector('label')) {
            return (prev.textContent || '').trim();
          }
          prev = prev.previousElementSibling;
        }
        
        // Try parent container's label
        const container = el.closest('[data-automation-id]') || el.closest('.css-1gd2l5o') || el.parentElement?.parentElement;
        if (container) {
          const lbl = container.querySelector('label') || container.previousElementSibling;
          if (lbl) return (lbl.textContent || '').trim();
        }
        
        // Use placeholder
        if (el.placeholder) return el.placeholder;
        
        // Use name/id as last resort
        return el.name || el.id || '';
      }
      
      // Helper to get section header AND question text
      function getSection(el) {
        const parts = [];
        
        // Try standard section header
        const section = el.closest('section, [role="group"], fieldset, [data-automation-id*="section"]');
        if (section) {
          const header = section.querySelector('h1, h2, h3, h4, legend, [data-automation-id="sectionHeader"]');
          if (header) parts.push(header.textContent.trim());
        }
        
        // For questionnaire fields, find the actual question text
        // Look for the closest container with question text
        const container = el.closest('[data-automation-id*="formField"], [data-automation-id*="question"]') || 
                          el.closest('.WDQO, [class*="question"]') ||
                          el.parentElement?.parentElement?.parentElement;
        
        if (container) {
          // Look for paragraph or label with the question
          const questionEl = container.querySelector('p, [data-automation-id*="label"], .gwt-Label, [class*="label"]');
          if (questionEl) {
            const qText = questionEl.textContent.trim();
            // Only add if it's not just "Select One" or a very short string
            if (qText && qText.length > 10 && !qText.toLowerCase().includes('select one')) {
              parts.push(qText);
            }
          }
          
          // Also try looking at previous siblings
          let prev = container.previousElementSibling;
          while (prev && parts.length < 3) {
            const prevText = prev.textContent?.trim();
            if (prevText && prevText.length > 20 && prevText.length < 500) {
              parts.push(prevText);
            }
            prev = prev.previousElementSibling;
          }
        }
        
        // Also look at immediate previous siblings of the element itself
        let prevSib = el.parentElement?.previousElementSibling;
        if (prevSib && prevSib.tagName !== 'BUTTON' && prevSib.tagName !== 'INPUT') {
          const prevText = prevSib.textContent?.trim();
          if (prevText && prevText.length > 20 && !parts.includes(prevText)) {
            parts.push(prevText);
          }
        }
        
        return parts.join(' | ').substring(0, 500);  // Limit length
      }

      // ========== TEXT INPUTS ==========
      document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])').forEach(input => {
        if (input.offsetParent === null) return; // Hidden
        if (input.disabled || input.readOnly) return;
        
        const label = getLabel(input);
        if (shouldSkip(label, input.id, input.name)) return;
        
        fields.push({
          type: 'text',
          selector: input.id ? `#${input.id}` : `input[name="${input.name}"]`,
          id: input.id,
          name: input.name,
          label: label,
          placeholder: input.placeholder,
          section: getSection(input),
          ariaLabel: input.getAttribute('aria-label'),
          required: input.hasAttribute('aria-required') || input.required,
          currentValue: input.value,
          isSearchable: input.hasAttribute('data-uxi-widget-type')
        });
      });

      // ========== TEXTAREAS ==========
      document.querySelectorAll('textarea').forEach(textarea => {
        if (textarea.offsetParent === null) return; // Hidden
        if (textarea.disabled || textarea.readOnly) return;
        
        const label = getLabel(textarea);
        if (shouldSkip(label, textarea.id, textarea.name)) return;
        
        // Skip if already has content
        const currentValue = textarea.value?.trim() || '';
        if (currentValue.length > 0) return;
        
        fields.push({
          type: 'textarea',
          selector: textarea.id ? `#${textarea.id}` : `textarea[name="${textarea.name}"]`,
          id: textarea.id,
          name: textarea.name,
          label: label,
          placeholder: textarea.placeholder,
          section: getSection(textarea),
          ariaLabel: textarea.getAttribute('aria-label'),
          required: textarea.hasAttribute('aria-required') || textarea.required,
          currentValue: currentValue
        });
      });

      // ========== DROPDOWN BUTTONS ==========
      document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(btn => {
        if (btn.offsetParent === null) return;
        
        const label = getLabel(btn);
        if (shouldSkip(label, btn.id, btn.name)) return;
        
        // Skip if it looks like already filled (has a value, not "Select One")
        const btnText = btn.textContent?.trim() || '';
        const isEmpty = !btnText || btnText.toLowerCase().includes('select');
        
        fields.push({
          type: 'dropdown',
          selector: btn.id ? `#${btn.id}` : `button[aria-label="${btn.getAttribute('aria-label')}"]`,
          id: btn.id,
          name: btn.name,
          label: label,
          section: getSection(btn),
          ariaLabel: btn.getAttribute('aria-label'),
          required: btn.getAttribute('aria-label')?.toLowerCase().includes('required'),
          currentValue: btnText,
          isEmpty: isEmpty
        });
      });

      // ========== RADIO BUTTONS ==========
      const radioGroups = new Set();
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        if (radio.offsetParent === null) return;
        if (radioGroups.has(radio.name)) return;
        radioGroups.add(radio.name);
        
        const label = getLabel(radio);
        if (shouldSkip(label, radio.id, radio.name)) return;
        
        // Get all options for this radio group
        const options = [];
        document.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => {
          const lbl = r.labels?.[0] || document.querySelector(`label[for="${r.id}"]`);
          options.push({
            value: r.value,
            label: lbl?.textContent?.trim() || r.value,
            checked: r.checked
          });
        });
        
        fields.push({
          type: 'radio',
          selector: `input[name="${radio.name}"]`,
          id: radio.id,
          name: radio.name,
          label: label,
          section: getSection(radio),
          required: radio.hasAttribute('aria-required'),
          options: options,
          currentValue: options.find(o => o.checked)?.label || ''
        });
      });

      // ========== CHECKBOXES (Single) ==========
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.offsetParent === null) return;
        
        // Skip if part of a checkbox group (fieldset)
        const fieldset = cb.closest('fieldset');
        if (fieldset && fieldset.querySelectorAll('input[type="checkbox"]').length > 1) return;
        
        const label = getLabel(cb);
        if (shouldSkip(label, cb.id, cb.name)) return;
        
        fields.push({
          type: 'checkbox',
          selector: cb.id ? `#${cb.id}` : `input[name="${cb.name}"]`,
          id: cb.id,
          name: cb.name,
          label: label,
          section: getSection(cb),
          required: cb.hasAttribute('aria-required'),
          currentValue: cb.checked
        });
      });

      // ========== CHECKBOX GROUPS (Fieldsets) ==========
      document.querySelectorAll('fieldset').forEach(fs => {
        if (fs.offsetParent === null) return;
        
        const checkboxes = fs.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length <= 1) return;
        
        const options = [];
        checkboxes.forEach(cb => {
          const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
          options.push({
            value: cb.value,
            label: lbl?.textContent?.trim() || cb.value,
            checked: cb.checked
          });
        });
        
        // Get fieldset label
        let label = fs.querySelector('legend')?.textContent?.trim() || '';
        if (!label) {
          const prev = fs.previousElementSibling;
          if (prev) label = prev.textContent?.trim() || '';
        }
        const fullText = fs.textContent?.substring(0, 200) || '';
        
        if (shouldSkip(label, fs.id, '')) return;
        
        fields.push({
          type: 'checkboxGroup',
          selector: fs.id ? `#${fs.id}` : `fieldset[data-automation-id="${fs.getAttribute('data-automation-id')}"]`,
          id: fs.id,
          label: label,
          fullText: fullText,
          section: getSection(fs),
          required: fs.hasAttribute('aria-required'),
          options: options,
          currentValue: options.filter(o => o.checked).map(o => o.label).join(', ')
        });
      });

      // ========== FILE INPUTS ==========
      const fileUpload = document.querySelector('[data-automation-id="file-upload-drop-zone"], input[type="file"]');
      if (fileUpload) {
        fields.push({
          type: 'file',
          selector: '[data-automation-id="select-files"], input[type="file"]',
          label: 'Resume/CV Upload',
          section: getSection(fileUpload),
          required: true
        });
      }

      return fields;
    });
    
    // Additional filtering - skip fields that already have values
    return rawFields.filter(f => {
      // Skip dropdowns that already have a non-empty value
      if (f.type === 'dropdown' && !f.isEmpty) {
        console.log(`   ⏭️ Skipping "${f.label}" - already filled`);
        return false;
      }
      return true;
    });
  }

  // ============================================
  // STEP 2: CLASSIFY ALL FIELDS WITH TWO-STAGE AI
  // Stage 1: Zero-Shot (DeBERTa) - 45% threshold
  // Stage 2: Semantic Similarity (BGE) - 60% threshold (fallback)
  // ============================================
  async classifyAllFields(fields) {
    const classifications = [];
    let stage2LoadedNotified = false;
    
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const fieldNum = i + 1;
      
      // Build context string for AI
      const context = this.buildContext(field);
      
      // Skip fields we can't build context for
      if (!context || context.length < 5) {
        console.log(`   [${fieldNum}/${fields.length}] ⏭️ Skipping (no context): ${field.label || field.id}`);
        classifications.push({ field, classification: null, context });
        continue;
      }
      
      // ========== STAGE 1: Zero-Shot Classification ==========
      process.stdout.write(`   [${fieldNum}/${fields.length}] 🧠 Analyzing: "${field.label || field.id}"... `);
      
      const stage1Result = await this.stage1Classifier.classifyField(context, field.type);
      
      let finalResult = stage1Result;
      let stage = 1;
      
      // ========== CHECK IF STAGE 2 NEEDED ==========
      if (stage1Result.confidence < STAGE1_THRESHOLD) {
        // Stage 1 confidence too low, try Stage 2
        console.log(`→ Stage 1: ${stage1Result.label} (${(stage1Result.confidence * 100).toFixed(1)}%) ← below ${STAGE1_THRESHOLD * 100}%`);
        
        // Load Stage 2 model if not loaded
        if (!this.stage2Classifier.isLoaded) {
          if (!stage2LoadedNotified) {
            console.log(`      📦 Loading Stage 2 model (BGE Semantic Similarity)...`);
            stage2LoadedNotified = true;
          }
          await this.stage2Classifier.loadModel();
        }
        
        // Run Stage 2
        const stage2Result = await this.stage2Classifier.classifyField(context);
        
        if (stage2Result.similarity >= STAGE2_THRESHOLD) {
          // Stage 2 found a good match
          console.log(`      ✅ Stage 2: ${stage2Result.fieldType} (${(stage2Result.similarity * 100).toFixed(1)}%) ← above ${STAGE2_THRESHOLD * 100}%`);
          finalResult = {
            label: stage2Result.fieldType,
            confidence: stage2Result.similarity,
            source: 'stage2_semantic'
          };
          stage = 2;
        } else {
          // Stage 2 also failed, use Stage 1 result anyway
          console.log(`      ⚠️ Stage 2: ${stage2Result.fieldType} (${(stage2Result.similarity * 100).toFixed(1)}%) ← below ${STAGE2_THRESHOLD * 100}%, keeping Stage 1`);
        }
      } else {
        // Stage 1 confidence is good
        console.log(`→ ${stage1Result.label} (${(stage1Result.confidence * 100).toFixed(1)}%)`);
      }
      
      // Debug: Show context for low confidence classifications
      if (finalResult.confidence < 0.5) {
        console.log(`      📋 Context: "${context}"`);
        console.log(`      📋 Field ID: ${field.id}, Name: ${field.name}`);
      }
      
      classifications.push({
        field,
        classification: finalResult,
        context,
        stage
      });
    }
    
    return classifications;
  }

  // ============================================
  // BUILD RICH CONTEXT FOR AI CLASSIFICATION
  // Extracts semantic hints from HTML attributes
  // ============================================
  buildContext(field) {
    const parts = [];
    
    // ========== EXTRACT SEMANTIC HINTS FROM ID ==========
    // IDs like "address--addressLine1" or "phoneNumber--phoneType" contain valuable info
    const idHints = this.extractSemanticHints(field.id);
    const nameHints = this.extractSemanticHints(field.name);
    
    // Combine unique hints
    const allHints = [...new Set([...idHints, ...nameHints])].filter(h => h.length > 2);
    
    // ========== PRIMARY: Label text ==========
    let cleanLabel = '';
    if (field.label && field.label.trim()) {
      cleanLabel = field.label
        .replace(/\*/g, '')
        .replace(/required/gi, '')
        .replace(/optional/gi, '')
        .replace(/select one/gi, '')
        .trim();
    }
    
    // ========== BUILD CONTEXT STRING ==========
    // Start with the most important info
    if (cleanLabel && cleanLabel.length > 2) {
      parts.push(`Field label: "${cleanLabel}"`);
    }
    
    // Add semantic hints from ID/name (very valuable!)
    if (allHints.length > 0) {
      parts.push(`HTML hints: ${allHints.join(', ')}`);
    }
    
    // Add aria-label if different and useful
    if (field.ariaLabel) {
      const cleanAria = field.ariaLabel
        .replace(/required/gi, '')
        .replace(/select one/gi, '')
        .replace(/\*/g, '')
        .trim();
      if (cleanAria && cleanAria !== cleanLabel && cleanAria.length > 5) {
        parts.push(`Description: "${cleanAria}"`);
      }
    }
    
    // Add section context
    if (field.section && field.section.trim()) {
      parts.push(`Section: "${field.section}"`);
    }
    
    // Add field type
    const typeNames = {
      'text': 'text input',
      'dropdown': 'dropdown select',
      'radio': 'radio buttons',
      'checkbox': 'checkbox',
      'checkboxGroup': 'checkbox group',
      'file': 'file upload'
    };
    if (field.type && typeNames[field.type]) {
      parts.push(`Type: ${typeNames[field.type]}`);
    }
    
    // Add options for dropdowns/radios (very helpful for classification)
    if (field.options && field.options.length > 0 && field.options.length <= 6) {
      const optLabels = field.options.map(o => o.label || o).join(', ');
      parts.push(`Options: [${optLabels}]`);
    }
    
    // Add placeholder
    if (field.placeholder && field.placeholder.trim() && field.placeholder !== 'Search') {
      parts.push(`Placeholder: "${field.placeholder}"`);
    }
    
    // For checkbox groups, include the question text
    if (field.fullText && field.fullText.trim() && field.type === 'checkboxGroup') {
      const question = field.fullText.substring(0, 150).trim();
      parts.push(`Question: "${question}"`);
    }
    
    return parts.join('. ');
  }
  
  // ============================================
  // EXTRACT SEMANTIC HINTS FROM HTML IDs/NAMES
  // "address--addressLine1" → ["address", "address line"]
  // "phoneNumber--phoneType" → ["phone number", "phone type"]
  // ============================================
  extractSemanticHints(value) {
    if (!value) return [];
    
    const hints = [];
    
    // Split by common delimiters: --, __, -, _
    const segments = value.split(/--|__|-|_/).filter(s => s.length > 0);
    
    for (const segment of segments) {
      // Skip IDs that look like random strings (UUIDs, hashes)
      if (/^[a-f0-9]{8,}$/i.test(segment)) continue;
      if (/^\d+$/.test(segment)) continue;
      
      // Convert camelCase to words: "addressLine1" → "address line"
      const words = segment
        .replace(/([A-Z])/g, ' $1')  // Insert space before capitals
        .replace(/(\d+)/g, ' $1')    // Insert space before numbers
        .toLowerCase()
        .trim();
      
      if (words.length > 2) {
        hints.push(words);
      }
    }
    
    return hints;
  }

  // ============================================
  // STEP 3: FILL CLASSIFIED FIELDS
  // ============================================
  async fillClassifiedFields(classifications) {
    // Extract all fields for context analysis (used by date detection)
    const allFields = classifications.map(c => c.field);
    
    for (const { field, classification, context } of classifications) {
      // Skip if no classification
      if (!classification) {
        this.skipped++;
        this.results.push({ field: field.label, status: 'skipped', reason: 'No context' });
        continue;
      }
      
      // Skip if confidence too low
      if (classification.confidence < 0.15) {
        console.log(`   ⏭️ "${field.label}" - confidence too low (${(classification.confidence * 100).toFixed(1)}%)`);
        this.skipped++;
        this.results.push({ 
          field: field.label, 
          status: 'skipped', 
          reason: `Low confidence: ${classification.label} (${(classification.confidence * 100).toFixed(1)}%)` 
        });
        continue;
      }
      
      // HARD OVERRIDES: These fields are commonly misclassified, always use field label
      let effectiveLabel = classification.label;
      const fieldLabelLower = (field.label || '').toLowerCase();
      const fieldIdLower = (field.id || '').toLowerCase();
      const sectionLower = (field.section || '').toLowerCase();
      const contextLower = (context || '').toLowerCase();
      
      // ============================================
      // SECTION-BASED OVERRIDES (for "Select One" questionnaire fields)
      // These check the actual question text in the section/context
      // ============================================
      
      // Work Authorization questions
      if (sectionLower.includes('authorized to work') || contextLower.includes('authorized to work') ||
          sectionLower.includes('legally authorized') || contextLower.includes('legally authorized') ||
          sectionLower.includes('legal right to work') || contextLower.includes('legal right to work') ||
          sectionLower.includes('eligible to work') || contextLower.includes('eligible to work')) {
        effectiveLabel = 'work_authorization_yes_no';
        console.log(`      📋 Section Override: work authorization (question text match)`);
      }
      // Visa Sponsorship questions
      else if (sectionLower.includes('require sponsorship') || contextLower.includes('require sponsorship') ||
               sectionLower.includes('need sponsorship') || contextLower.includes('need sponsorship') ||
               sectionLower.includes('visa sponsorship') || contextLower.includes('visa sponsorship') ||
               (sectionLower.includes('sponsorship') && sectionLower.includes('visa'))) {
        effectiveLabel = 'sponsorship_yes_no';
        console.log(`      📋 Section Override: sponsorship (question text match)`);
      }
      // Relative at company questions
      else if (sectionLower.includes('relative') || contextLower.includes('relative') ||
               sectionLower.includes('family member') || contextLower.includes('family member') ||
               sectionLower.includes('related to anyone') || contextLower.includes('related to anyone')) {
        effectiveLabel = 'has_relative_at_company';
        console.log(`      📋 Section Override: relative at company (question text match)`);
      }
      // Non-compete / Restrictive agreements questions
      else if (sectionLower.includes('non-compete') || contextLower.includes('non-compete') ||
               sectionLower.includes('noncompete') || contextLower.includes('noncompete') ||
               sectionLower.includes('non-solicitation') || contextLower.includes('non-solicitation') ||
               sectionLower.includes('restrictive agreement') || contextLower.includes('restrictive agreement') ||
               sectionLower.includes('bound by any agreement') || contextLower.includes('bound by any agreement') ||
               (sectionLower.includes('agreement') && sectionLower.includes('previous employer'))) {
        effectiveLabel = 'has_restrictive_agreement';
        console.log(`      📋 Section Override: restrictive agreement (question text match)`);
      }
      // Background check consent
      else if (sectionLower.includes('background check') || contextLower.includes('background check') ||
               sectionLower.includes('background investigation') || contextLower.includes('background investigation')) {
        effectiveLabel = 'consent_background_check';
        console.log(`      📋 Section Override: background check (question text match)`);
      }
      // Drug test consent
      else if (sectionLower.includes('drug test') || contextLower.includes('drug test') ||
               sectionLower.includes('drug screen') || contextLower.includes('drug screen')) {
        effectiveLabel = 'consent_drug_test';
        console.log(`      📋 Section Override: drug test (question text match)`);
      }
      // Previously employed questions
      else if (sectionLower.includes('previously employed') || contextLower.includes('previously employed') ||
               sectionLower.includes('worked for this company') || contextLower.includes('worked for this company') ||
               sectionLower.includes('former employee') || contextLower.includes('former employee') ||
               sectionLower.includes('worked here before') || contextLower.includes('worked here before')) {
        effectiveLabel = 'previously_employed';
        console.log(`      📋 Section Override: previously employed (question text match)`);
      }
      // Currently employed questions
      else if (sectionLower.includes('currently employed') || contextLower.includes('currently employed') ||
               sectionLower.includes('presently employed') || contextLower.includes('presently employed')) {
        effectiveLabel = 'currently_employed';
        console.log(`      📋 Section Override: currently employed (question text match)`);
      }
      // Contact current employer questions
      else if (sectionLower.includes('contact your current employer') || contextLower.includes('contact your current employer') ||
               sectionLower.includes('contact your present employer') || contextLower.includes('contact your present employer') ||
               sectionLower.includes('may we contact') || contextLower.includes('may we contact')) {
        effectiveLabel = 'can_contact_employer';
        console.log(`      📋 Section Override: contact employer (question text match)`);
      }
      // Over 18 / legal age questions
      else if (sectionLower.includes('over 18') || contextLower.includes('over 18') ||
               sectionLower.includes('at least 18') || contextLower.includes('at least 18') ||
               sectionLower.includes('legal age') || contextLower.includes('legal age')) {
        effectiveLabel = 'over_18';
        console.log(`      📋 Section Override: over 18 (question text match)`);
      }
      // Criminal history questions
      else if (sectionLower.includes('convicted') || contextLower.includes('convicted') ||
               sectionLower.includes('criminal') || contextLower.includes('criminal') ||
               sectionLower.includes('felony') || contextLower.includes('felony')) {
        effectiveLabel = 'criminal_history';
        console.log(`      📋 Section Override: criminal history (question text match)`);
      }
      // Willing to relocate questions  
      else if (sectionLower.includes('willing to relocate') || contextLower.includes('willing to relocate') ||
               sectionLower.includes('open to relocation') || contextLower.includes('open to relocation')) {
        effectiveLabel = 'willing_to_relocate';
        console.log(`      📋 Section Override: willing to relocate (question text match)`);
      }
      // Willing to travel questions
      else if (sectionLower.includes('willing to travel') || contextLower.includes('willing to travel') ||
               sectionLower.includes('travel requirement') || contextLower.includes('travel requirement')) {
        effectiveLabel = 'willing_to_travel';
        console.log(`      📋 Section Override: willing to travel (question text match)`);
      }
      // Citizenship questions - "Country of Citizenship"
      else if (sectionLower.includes('country of citizenship') || contextLower.includes('country of citizenship') ||
               sectionLower.includes('countries of citizenship') || contextLower.includes('countries of citizenship') ||
               fieldLabelLower.includes('citizenship')) {
        effectiveLabel = 'citizenship_country';
        console.log(`      📋 Section Override: citizenship country (question text match)`);
      }
      // Restricted countries citizenship question (Group D countries, export control)
      else if (sectionLower.includes('citizen of any of the following countries') || 
               contextLower.includes('citizen of any of the following countries') ||
               sectionLower.includes('group d') || contextLower.includes('group d') ||
               (sectionLower.includes('citizen') && (sectionLower.includes('armenia') || sectionLower.includes('russia') || 
                sectionLower.includes('china') || sectionLower.includes('iran')))) {
        effectiveLabel = 'restricted_country_citizen';
        console.log(`      📋 Section Override: restricted country citizen (question text match)`);
      }
      // ============================================
      // Address fields - ALWAYS override based on field label
      // ============================================
      else if (fieldLabelLower.includes('address line 1') || fieldIdLower.includes('addressline1')) {
        effectiveLabel = 'address line 1';
        console.log(`      📋 Override: address line 1 (field label match)`);
      } else if (fieldLabelLower.includes('address line 2') || fieldIdLower.includes('addressline2')) {
        effectiveLabel = 'address line 2';
        console.log(`      📋 Override: address line 2 (field label match)`);
      } else if (fieldLabelLower.includes('postal code') || fieldLabelLower.includes('zip code') || 
                 fieldIdLower.includes('postal') || fieldIdLower.includes('zipcode')) {
        effectiveLabel = 'postal code';
        console.log(`      📋 Override: postal code (field label match)`);
      } 
      // CRITICAL: Phone Number override MUST come before Country Phone Code
      // "Phone Number*" should NOT be matched as country_phone_code
      // Also exclude "extension" fields
      else if ((fieldLabelLower.includes('phone number') && !fieldLabelLower.includes('code') && !fieldLabelLower.includes('country') && !fieldLabelLower.includes('extension')) ||
               (fieldIdLower.includes('phonenumber') && !fieldIdLower.includes('countryphone') && !fieldIdLower.includes('phonecode') && !fieldIdLower.includes('extension'))) {
        effectiveLabel = 'phone_number';
        console.log(`      📋 Override: phone number (field label match)`);
      } else if (fieldLabelLower.includes('country phone') || fieldIdLower.includes('countryphone') ||
                 fieldLabelLower.includes('phone code')) {
        effectiveLabel = 'country phone code';
        console.log(`      📋 Override: country phone code (field label match)`);
      }
      // ============================================
      // EEO (Equal Employment Opportunity) fields
      // ============================================
      else if (fieldLabelLower.includes('hispanic') || fieldLabelLower.includes('latino') || 
               fieldIdLower.includes('hispanic')) {
        effectiveLabel = 'hispanic_latino';
        console.log(`      📋 Override: hispanic/latino (field label match)`);
      }
      else if (fieldLabelLower.includes('gender') || fieldIdLower.includes('gender')) {
        effectiveLabel = 'gender';
        console.log(`      📋 Override: gender (field label match)`);
      }
      else if (fieldLabelLower.includes('veteran') || fieldIdLower.includes('veteran')) {
        effectiveLabel = 'veteran_status';
        console.log(`      📋 Override: veteran status (field label match)`);
      }
      else if ((fieldLabelLower.includes('race') || fieldLabelLower.includes('ethnicity') ||
                fieldIdLower.includes('ethnicity') || fieldIdLower.includes('race')) &&
               !fieldLabelLower.includes('hispanic')) {
        effectiveLabel = 'race_ethnicity';
        console.log(`      📋 Override: race/ethnicity (field label match)`);
      }
      else if (fieldLabelLower.includes('disability') && 
               !fieldLabelLower.includes('name') && 
               !fieldLabelLower.includes('date') &&
               !fieldLabelLower.includes('month') &&
               !fieldLabelLower.includes('day') &&
               !fieldLabelLower.includes('year')) {
        // Only apply disability override to actual disability status fields
        // NOT to signature fields (name, date) that happen to be on the disability page
        effectiveLabel = 'disability_status';
        console.log(`      📋 Override: disability status (field label match)`);
      }
      // Specific disability status field (checkbox group)
      else if (fieldIdLower.endsWith('disabilitystatus') || 
               fieldLabelLower.includes('check one of the boxes below')) {
        effectiveLabel = 'disability_status';
        console.log(`      📋 Override: disability status (field ID match)`);
      }
      // Signature fields on disability/EEO pages
      else if (fieldIdLower.includes('disabilitydata--name') || 
               (fieldLabelLower === 'name*' && sectionLower.includes('disability'))) {
        effectiveLabel = 'signature_name';
        console.log(`      📋 Override: signature name (disability form)`);
      }
      else if (fieldIdLower.includes('employeeid')) {
        // Skip employee ID fields - only for existing employees
        effectiveLabel = 'employee_id_skip';
        console.log(`      📋 Override: employee ID (skip - optional)`);
      }
      // ============================================
      // DATE FIELD DETECTION WITH CONTEXT AWARENESS
      // ============================================
      // Detect date fields by label (month, day, year, date) or AI classification
      else if (fieldLabelLower === 'month' || fieldLabelLower === 'day' || fieldLabelLower === 'year' ||
               fieldLabelLower.includes('date') || classification.label === 'a date' ||
               fieldIdLower.includes('date') || fieldIdLower.includes('month') || 
               fieldIdLower.includes('day') || fieldIdLower.includes('year')) {
        // Use context detection to determine what type of date
        const dateContext = this.detectDateContext(field, field.section || sectionLower, allFields);
        
        // Map date context to effective label
        if (dateContext === 'date_of_birth') {
          effectiveLabel = 'date_of_birth';
        } else if (dateContext === 'graduation_date') {
          effectiveLabel = 'graduation_date';
        } else if (dateContext === 'employment_start_date') {
          effectiveLabel = 'employment_start_date';
        } else if (dateContext === 'employment_end_date') {
          effectiveLabel = 'employment_end_date';
        } else if (dateContext === 'license_issue_date') {
          effectiveLabel = 'license_issue_date';
        } else if (dateContext === 'license_expiry_date') {
          effectiveLabel = 'license_expiry_date';
        } else if (dateContext === 'certificate_issue_date') {
          effectiveLabel = 'certificate_issue_date';
        } else if (dateContext === 'certificate_expiry_date') {
          effectiveLabel = 'certificate_expiry_date';
        } else if (dateContext === 'available_start_date') {
          effectiveLabel = 'available_start_date';
        } else if (dateContext === 'signature_date') {
          effectiveLabel = 'signature_date';
        } else {
          // Default to signature date (today) if unknown
          effectiveLabel = 'signature_date';
        }
        
        // Store date context and field part for value retrieval
        field.dateContext = dateContext;
        field.datePart = fieldLabelLower; // 'month', 'day', 'year', or full date
        
        console.log(`      📋 Date Override: ${effectiveLabel} (${field.datePart})`);
      }
      else if (classification.confidence < 0.50) {
        // SOFT OVERRIDES: Only when AI confidence is low
        if (fieldLabelLower.includes('city') && !fieldLabelLower.includes('address')) {
          effectiveLabel = 'city';
          console.log(`      📋 Override: city (low confidence fallback)`);
        } else if (fieldLabelLower.includes('state') || fieldIdLower.includes('state') || fieldIdLower.includes('region')) {
          effectiveLabel = 'state';
          console.log(`      📋 Override: state (low confidence fallback)`);
        }
      }
      
      // Get value from profile based on classification (or override)
      const value = this.getValueForClassification(effectiveLabel, field);
      
      if (value === null || value === undefined) {
        console.log(`   ⏭️ "${field.label}" → ${classification.label} - no value in profile`);
        this.skipped++;
        this.results.push({ 
          field: field.label, 
          status: 'skipped', 
          reason: `No profile value for: ${classification.label}` 
        });
        continue;
      }
      
      // Fill the field
      const success = await this.fillField(field, value, classification.label);
      
      if (success) {
        console.log(`   ✅ "${field.label}" → ${classification.label} = "${value}"`);
        this.filled++;
        this.results.push({ field: field.label, status: 'filled', classification: classification.label, value });
      } else {
        console.log(`   ❌ "${field.label}" → Failed to fill`);
        this.failed++;
        this.results.push({ field: field.label, status: 'failed', classification: classification.label, value });
      }
    }
  }

  // ============================================
  // MAP CLASSIFICATION TO PROFILE VALUE
  // Handles both Stage 1 (natural language) and Stage 2 (snake_case) labels
  // ============================================
  getValueForClassification(label, field) {
    const p = this.profile;
    const labelLower = label.toLowerCase();
    
    // ========== STAGE 2 LABELS (snake_case) ==========
    // These come directly from semantic similarity classifier
    if (labelLower === 'first_name') return p.personal?.firstName;
    if (labelLower === 'middle_name') return p.personal?.middleName || null;
    if (labelLower === 'last_name') return p.personal?.lastName;
    if (labelLower === 'email') return p.personal?.email;
    if (labelLower === 'phone_number') return p.personal?.phone?.replace(/[\(\)\-\s]/g, '');
    if (labelLower === 'phone_extension') return null;
    if (labelLower === 'country_phone_code') return 'United States of America (+1)';
    if (labelLower === 'address_line_1') return p.address?.line1;
    if (labelLower === 'address_line_2') return p.address?.line2 || null;
    if (labelLower === 'city') return p.address?.city;
    if (labelLower === 'state') return p.address?.state;
    if (labelLower === 'postal_code') return p.address?.zipCode;
    if (labelLower === 'country') return 'United States of America';
    if (labelLower === 'linkedin') return p.personal?.linkedIn;
    if (labelLower === 'work_authorization') return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    if (labelLower === 'visa_sponsorship') return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    if (labelLower === 'previous_employee') return 'No';
    if (labelLower === 'referral_source') return 'LinkedIn';
    if (labelLower === 'school') return p.education?.school;
    if (labelLower === 'degree') {
      const d = (p.education?.degree || '').toLowerCase();
      if (d.includes('master')) return "Master's Degree";
      if (d.includes('bachelor')) return "Bachelor's Degree";
      if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
      return p.education?.degree || "Bachelor's Degree";
    }
    if (labelLower === 'field_of_study') return p.education?.fieldOfStudy;
    if (labelLower === 'gender') return p.eeo?.gender || 'Male';
    if (labelLower === 'ethnicity') return p.eeo?.race || 'Asian';
    // Note: veteran_status and disability_status are handled in the detailed EEO section below
    
    // ========== PERSONAL INFO (Stage 1 natural language) ==========
    // Labels: "a person's first name", "a person's middle name", "a person's last name or surname"
    if (labelLower.includes('first name')) {
      return p.personal?.firstName;
    }
    if (labelLower.includes('middle name')) {
      return p.personal?.middleName || null;  // Skip if no middle name
    }
    if (labelLower.includes('last name') || labelLower.includes('surname')) {
      return p.personal?.lastName;
    }
    if (labelLower.includes('email')) {
      return p.personal?.email;
    }
    
    // ========== PHONE ==========
    // Labels: "a phone number", "type of phone device", "country phone code like +1", "phone extension"
    if (labelLower.includes('phone number') && !labelLower.includes('code') && !labelLower.includes('type')) {
      return p.personal?.phone?.replace(/[\(\)\-\s]/g, '');
    }
    if (labelLower.includes('type of phone') || labelLower.includes('phone device')) {
      return 'Mobile';
    }
    if (labelLower === 'country phone code' || labelLower.includes('country phone code') || labelLower.includes('phone code')) {
      return 'United States of America (+1)';
    }
    if (labelLower.includes('phone extension')) {
      return null;  // Skip - most people don't have one
    }
    
    // ========== SOCIAL ==========
    // Label: "a LinkedIn profile URL"
    if (labelLower.includes('linkedin')) {
      return p.personal?.linkedIn;
    }
    
    // ========== ADDRESS ==========
    // Labels: "address line 1 or street address", "name of a city", "state or province", "postal code or zip code", "country name"
    // Also handles simple override labels: "address line 1", "postal code", "city"
    if (labelLower === 'address line 1' || labelLower.includes('address line') || labelLower.includes('street address') || labelLower.includes('mailing address')) {
      return p.address?.line1;
    }
    if (labelLower === 'address line 2' || labelLower.includes('apartment') || labelLower.includes('suite') || labelLower.includes('unit')) {
      return p.address?.line2 || null;  // Skip if no line2
    }
    if (labelLower === 'city' || 
        ((labelLower.includes('city') || labelLower.includes('town')) && 
         !labelLower.includes('ethnicity'))) {
      return p.address?.city;
    }
    if (labelLower === 'state' || labelLower.includes('state') || labelLower.includes('province') || labelLower.includes('region')) {
      return p.address?.state;
    }
    if (labelLower === 'postal code' || labelLower.includes('postal') || labelLower.includes('zip')) {
      return p.address?.zipCode;
    }
    
    // ========== CITIZENSHIP (MUST come before generic country check) ==========
    // Citizenship - country of citizenship
    if (labelLower === 'citizenship_country') {
      return p.personal?.citizenship || 'India';
    }
    // Restricted country citizen (Group D countries - export control)
    if (labelLower === 'restricted_country_citizen') {
      return p.additional?.isRestrictedCountryCitizen ? 'Yes' : 'No';
    }
    
    // Generic country check (exclude citizenship labels and phone)
    if ((labelLower.includes('country name') || labelLower.includes('country')) && 
        !labelLower.includes('phone') && 
        !labelLower.includes('citizenship') &&
        !labelLower.includes('restricted')) {
      return 'United States of America';
    }
    
    // ========== WORK AUTHORIZATION ==========
    // Labels: "authorized to work in this country", "requires visa sponsorship", "previously worked at this company"
    if (labelLower.includes('authorized to work')) {
      return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    }
    if (labelLower.includes('visa sponsorship') || labelLower.includes('requires visa') || labelLower.includes('require sponsorship')) {
      return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    }
    if (labelLower.includes('previously worked') || labelLower.includes('previously employed')) {
      return p.additional?.previouslyEmployed ? 'Yes' : 'No';
    }
    
    // ========== SECTION-BASED OVERRIDES (Yes/No questions) ==========
    // These are the new labels from section text analysis
    if (labelLower === 'work_authorization_yes_no') {
      return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    }
    if (labelLower === 'sponsorship_yes_no') {
      return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    }
    if (labelLower === 'has_relative_at_company') {
      return p.additional?.hasRelativeAtCompany ? 'Yes' : 'No';
    }
    if (labelLower === 'has_restrictive_agreement') {
      return p.additional?.hasRestrictiveAgreement ? 'Yes' : 'No';
    }
    if (labelLower === 'consent_background_check') {
      return p.additional?.consentBackgroundCheck ? 'Yes' : 'No';
    }
    if (labelLower === 'consent_drug_test') {
      return p.additional?.consentDrugTest ? 'Yes' : 'No';
    }
    if (labelLower === 'previously_employed') {
      return p.additional?.previouslyEmployed ? 'Yes' : 'No';
    }
    if (labelLower === 'currently_employed') {
      return p.additional?.currentlyEmployed ? 'Yes' : 'No';
    }
    if (labelLower === 'can_contact_employer') {
      return p.additional?.canContactCurrentEmployer ? 'Yes' : 'No';
    }
    if (labelLower === 'over_18') {
      return p.additional?.over18 ? 'Yes' : 'No';
    }
    if (labelLower === 'criminal_history') {
      return p.additional?.criminalHistory ? 'Yes' : 'No';
    }
    if (labelLower === 'willing_to_relocate') {
      return p.employment?.willingToRelocate ? 'Yes' : 'No';
    }
    if (labelLower === 'willing_to_travel') {
      return p.employment?.willingToTravel ? 'Yes' : 'No';
    }
    
    // ========== EEO (Equal Employment Opportunity) ==========
    if (labelLower === 'hispanic_latino') {
      // If ethnicity is explicitly set to Hispanic/Latino, return Yes, otherwise No
      const ethnicity = (p.eeo?.ethnicity || '').toLowerCase();
      if (ethnicity.includes('hispanic') || ethnicity.includes('latino')) {
        return 'Yes';
      }
      return 'No';
    }
    if (labelLower === 'gender') {
      return p.eeo?.gender || 'Male';
    }
    if (labelLower === 'veteran_status') {
      // Map profile value to dropdown option text
      const status = (p.eeo?.veteranStatus || '').toLowerCase();
      if (status.includes('not a veteran') || status.includes('am not')) {
        return 'I AM NOT A VETERAN';
      }
      if (status.includes('protected') || status.includes('one or more')) {
        return 'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN';
      }
      if (status.includes('just not') || status.includes('not a protected')) {
        return 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN';
      }
      if (status.includes('not wish') || status.includes('decline')) {
        return 'I DO NOT WISH TO SELF-IDENTIFY';
      }
      return p.eeo?.veteranStatus || 'I AM NOT A VETERAN';
    }
    if (labelLower === 'race_ethnicity') {
      // Return race for checkbox selection
      return p.eeo?.race || 'Asian';
    }
    if (labelLower === 'disability_status') {
      const status = (p.eeo?.disabilityStatus || '').toLowerCase();
      if (status.includes('no') || status.includes('do not have')) {
        return 'No, I do not have a disability';
      }
      if (status.includes('yes') || status.includes('have a disability')) {
        return 'Yes, I have a disability';
      }
      if (status.includes('not wish') || status.includes('decline')) {
        return 'I do not wish to answer';
      }
      return p.eeo?.disabilityStatus || 'No, I do not have a disability';
    }
    
    // ========== REFERRAL SOURCE ==========
    // Label: "how the applicant heard about this job"
    if (labelLower.includes('heard about') || labelLower.includes('how') && labelLower.includes('job')) {
      return p.referral?.source || 'LinkedIn';
    }
    
    // ========== EDUCATION ==========
    // Labels: "name of a school or university", "academic degree level", "field of study or major"
    if (labelLower.includes('school') || labelLower.includes('university')) {
      return p.education?.school;
    }
    if (labelLower.includes('degree level') || labelLower.includes('academic degree')) {
      const d = (p.education?.degree || '').toLowerCase();
      if (d.includes('master')) return "Master's Degree";
      if (d.includes('bachelor')) return "Bachelor's Degree";
      if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
      return p.education?.degree;
    }
    if (labelLower.includes('field of study') || labelLower.includes('major')) {
      return p.education?.fieldOfStudy;
    }
    
    // ========== EEO / DEMOGRAPHICS (AI-generated labels) ==========
    // These catch Stage 1 AI labels like "gender identity", "race or ethnicity information"
    // NOTE: Our override labels like 'race_ethnicity', 'veteran_status' are handled above
    if (labelLower.includes('gender') && !labelLower.includes('_')) {
      return p.eeo?.gender || 'Male';
    }
    if ((labelLower.includes('race') || labelLower.includes('ethnicity')) && !labelLower.includes('_')) {
      return p.eeo?.race || 'Asian';
    }
    if (labelLower.includes('veteran') && !labelLower.includes('_')) {
      const v = (p.eeo?.veteranStatus || '').toLowerCase();
      if (v.includes('not a veteran') || v.includes('am not')) return 'I AM NOT A VETERAN';
      if (v.includes('not') || !v) return 'I AM NOT A VETERAN';
      return p.eeo?.veteranStatus || 'I AM NOT A VETERAN';
    }
    if (labelLower.includes('disability') && !labelLower.includes('_')) {
      const d = (p.eeo?.disabilityStatus || '').toLowerCase();
      if (d.includes('no') || !d) return 'No, I do not have a disability';
      if (d.includes('yes')) return 'Yes, I have a disability';
      return 'I do not wish to answer';
    }
    
    // ========== AGREEMENTS & LEGAL ==========
    // Label: "agreement to terms and conditions"
    // CRITICAL: Return string "Yes" not boolean true (causes "text is not iterable" error)
    if (labelLower.includes('terms') || labelLower.includes('agreement') || labelLower.includes('acknowledge') || labelLower.includes('consent')) {
      return p.additional?.agreeToTerms ? 'Yes' : 'Yes';  // Default to Yes for agreements
    }
    
    // Non-compete / Non-solicitation agreements
    if (labelLower.includes('non-compete') || labelLower.includes('noncompete') || 
        labelLower.includes('non-solicitation') || labelLower.includes('nonsolicitation') ||
        labelLower.includes('bound by') || labelLower.includes('restrictive agreement')) {
      return p.additional?.hasRestrictiveAgreement ? 'Yes' : 'No';
    }
    
    // Relative/family at company
    if (labelLower.includes('relative') || labelLower.includes('family member') || labelLower.includes('related to')) {
      return p.additional?.hasRelativeAtCompany ? 'Yes' : 'No';
    }
    
    // Background check consent
    if (labelLower.includes('background check') || labelLower.includes('background investigation')) {
      return p.additional?.consentBackgroundCheck ? 'Yes' : 'Yes';  // Default Yes
    }
    
    // Drug test consent
    if (labelLower.includes('drug test') || labelLower.includes('drug screen')) {
      return p.additional?.consentDrugTest ? 'Yes' : 'Yes';  // Default Yes
    }
    
    // ========== EMPLOYMENT HISTORY ==========
    // Currently employed
    if (labelLower.includes('currently employed') || labelLower.includes('presently employed')) {
      return p.additional?.currentlyEmployed ? 'Yes' : 'Yes';  // Most applicants are currently employed
    }
    
    // Can contact current employer
    if (labelLower.includes('contact') && (labelLower.includes('current employer') || labelLower.includes('present employer'))) {
      return p.additional?.canContactCurrentEmployer ? 'Yes' : 'No';
    }
    
    // ========== AVAILABILITY ==========
    // Available to start
    if (labelLower.includes('available') && (labelLower.includes('start') || labelLower.includes('begin'))) {
      return p.employment?.availableStartDate || 'Immediately';
    }
    
    // Willing to relocate
    if (labelLower.includes('relocate') || labelLower.includes('relocation')) {
      return p.employment?.willingToRelocate ? 'Yes' : 'No';
    }
    
    // Willing to travel
    if (labelLower.includes('travel')) {
      return p.employment?.willingToTravel ? 'Yes' : 'Yes';  // Default Yes
    }
    
    // ========== SIGNATURE / DATE ==========
    // Handle all date types using context-aware detection
    
    // Signature name on disability/EEO forms (exact match)
    if (labelLower === 'signature_name') {
      return `${p.personal?.firstName} ${p.personal?.lastName}`;
    }
    // Employee ID - skip (only for existing employees)
    if (labelLower === 'employee_id_skip') {
      return null;  // Skip this field
    }
    
    // ========== ALL DATE TYPES ==========
    // Use the comprehensive date value retrieval
    const dateTypes = [
      'date_of_birth', 'graduation_date', 
      'employment_start_date', 'employment_end_date',
      'license_issue_date', 'license_expiry_date',
      'certificate_issue_date', 'certificate_expiry_date',
      'available_start_date', 'signature_date'
    ];
    
    if (dateTypes.includes(labelLower)) {
      const dateValue = this.getDateValue(labelLower, field, p);
      console.log(`      📅 Date value for ${labelLower}: ${dateValue}`);
      return dateValue;
    }
    
    // Legacy: signature_date_part (for backward compatibility)
    if (labelLower === 'signature_date_part') {
      const today = new Date();
      const fieldLabel = (field?.label || '').toLowerCase();
      if (fieldLabel.includes('month')) {
        return String(today.getMonth() + 1);  // 1-12
      }
      if (fieldLabel.includes('day')) {
        return String(today.getDate());  // 1-31
      }
      if (fieldLabel.includes('year')) {
        return String(today.getFullYear());  // 2026
      }
      return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    }
    
    // Generic signature (AI-generated label) - must exclude our override labels
    if ((labelLower.includes('signature') || labelLower.includes('legal name')) && 
        !labelLower.includes('_')) {
      return `${p.personal?.firstName} ${p.personal?.lastName}`;
    }
    
    // Generic date (AI-generated "a date" label) - default to today
    if (labelLower === 'a date') {
      const today = new Date();
      return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    }
    
    // ========== FILE UPLOAD ==========
    // Label: "a resume or CV file upload"
    if (labelLower.includes('resume') || labelLower.includes('cv')) {
      return p.documents?.resumePath;
    }
    
    return null;
  }

  // ============================================
  // FILL A SINGLE FIELD
  // Uses battle-tested Workday platform methods
  // ============================================
  async fillField(field, value, classificationLabel) {
    const label = field.label || field.id || 'unknown';
    
    try {
      let result;
      
      // Check if this is a Workday date field (spinbutton with 0x0 size)
      // These need special handling
      if (field.type === 'text' && 
          (field.label?.toLowerCase() === 'month' || 
           field.label?.toLowerCase() === 'day' || 
           field.label?.toLowerCase() === 'year' ||
           field.id?.includes('dateSection') ||
           field.id?.includes('dateSigned'))) {
        const dateResult = await this.fillWorkdayDateField(field, value);
        if (dateResult !== null) {
          return dateResult;
        }
        // If date handler returns null, fall through to regular handling
      }
      
      switch (field.type) {
        case 'text':
          if (field.isSearchable) {
            result = await this.platform.fillSearchable(this.page, field.selector, value, label, this.classifier);
          } else {
            result = await this.platform.fillTextInput(this.page, field.selector, value, label);
          }
          break;
          
        case 'textarea':
          // Use fillTextInput for textareas - same typing logic works
          result = await this.platform.fillTextInput(this.page, field.selector, value, label);
          break;
          
        case 'dropdown':
          result = await this.platform.fillDropdown(this.page, field.selector, value, label, this.classifier);
          break;
          
        case 'radio':
          result = await this.platform.fillRadio(this.page, field.selector, value, label);
          break;
          
        case 'checkbox':
          // Handle various truthy values: true, 'true', 'Yes', 'yes', etc.
          const shouldCheck = value === true || value === 'true' || 
                             (typeof value === 'string' && value.toLowerCase() === 'yes');
          result = await this.platform.fillCheckbox(this.page, field.selector, shouldCheck, label);
          break;
          
        case 'checkboxGroup':
          result = await this.platform.fillCheckboxGroup(this.page, field.selector, value, label, this.classifier);
          break;
          
        case 'file':
          return await this.fillFile(field, value);
          
        default:
          return false;
      }
      
      return result?.success || false;
      
    } catch (e) {
      console.log(`      ❌ Error filling ${label}: ${e.message}`);
      return false;
    }
  }

  // ============================================
  // WORKDAY DATE PICKER HANDLER
  // Handles Workday's hidden spinbutton date inputs
  // ============================================
  async fillWorkdayDateField(field, value) {
    const label = field.label || 'date field';
    
    console.log(`\n  ┌─── DEBUG: fillWorkdayDateField("${label}") ───`);
    console.log(`  │ Selector: ${field.selector}`);
    console.log(`  │ Value: ${value}`);
    
    try {
      // Find the input element
      const element = await this.page.$(field.selector);
      if (!element) {
        console.log(`  │ ❌ Element not found`);
        console.log(`  └─── END DEBUG ───\n`);
        return false;
      }
      
      // Check if element is a hidden spinbutton (0x0 size)
      const elementInfo = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        
        return {
          width: rect.width,
          height: rect.height,
          role: el.getAttribute('role'),
          type: el.type,
          // FIXED: Check for sub-pixel sizes (< 1px is effectively hidden)
          isHidden: rect.width < 1 || rect.height < 1,
          parentId: el.parentElement?.id,
          containerId: el.closest('[data-automation-id]')?.getAttribute('data-automation-id'),
          // Find the visible wrapper/container
          wrapperInfo: (() => {
            // Look for the date section wrapper
            let wrapper = el.closest('[data-automation-id*="dateSection"]');
            if (!wrapper) wrapper = el.closest('[data-automation-id*="date"]');
            if (!wrapper) wrapper = el.parentElement?.parentElement;
            
            if (wrapper) {
              const wRect = wrapper.getBoundingClientRect();
              return {
                found: true,
                width: wRect.width,
                height: wRect.height,
                top: wRect.top,
                left: wRect.left,
                automationId: wrapper.getAttribute('data-automation-id'),
                tagName: wrapper.tagName
              };
            }
            return { found: false };
          })()
        };
      }, field.selector);
      
      if (!elementInfo) {
        console.log(`  │ ❌ Could not get element info`);
        console.log(`  └─── END DEBUG ───\n`);
        return false;
      }
      
      console.log(`  │ Element size: ${elementInfo.width}x${elementInfo.height}px`);
      console.log(`  │ Role: ${elementInfo.role}`);
      console.log(`  │ Is hidden: ${elementInfo.isHidden}`);
      console.log(`  │ Container: ${elementInfo.containerId}`);
      
      if (elementInfo.wrapperInfo.found) {
        console.log(`  │ Wrapper found: ${elementInfo.wrapperInfo.automationId} (${elementInfo.wrapperInfo.width}x${elementInfo.wrapperInfo.height}px)`);
      }
      
      // Strategy 1: If element is visible (not 0x0), use regular fill
      if (!elementInfo.isHidden) {
        console.log(`  │ Element is visible - using standard fill`);
        console.log(`  └─── END DEBUG ───\n`);
        return null;  // Return null to fall through to regular handling
      }
      
      // Strategy 2: Try to find and click the visible container, then type
      console.log(`  │ Element is hidden (${elementInfo.width}x${elementInfo.height}px) - trying container approach`);
      
      // Find a clickable parent element
      const clickableInfo = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        
        // Walk up the DOM to find a clickable element with size
        let current = el.parentElement;
        const maxDepth = 5;
        let depth = 0;
        
        while (current && depth < maxDepth) {
          const rect = current.getBoundingClientRect();
          
          // Check if this element is visible and clickable
          if (rect.width > 10 && rect.height > 10) {
            const styles = window.getComputedStyle(current);
            
            // Skip if hidden
            if (styles.display === 'none' || styles.visibility === 'hidden') {
              current = current.parentElement;
              depth++;
              continue;
            }
            
            // Found a visible container
            return {
              found: true,
              tagName: current.tagName,
              automationId: current.getAttribute('data-automation-id'),
              className: current.className,
              centerX: rect.left + rect.width / 2,
              centerY: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height,
              // Check for any input/text element inside that might be better
              hasInput: current.querySelector('input:not([type="hidden"])') !== null,
              inputValue: current.querySelector('input')?.value || ''
            };
          }
          
          current = current.parentElement;
          depth++;
        }
        
        return { found: false };
      }, field.selector);
      
      if (!clickableInfo || !clickableInfo.found) {
        console.log(`  │ ❌ Could not find clickable container`);
        console.log(`  └─── END DEBUG ───\n`);
        return false;
      }
      
      console.log(`  │ Found clickable container: ${clickableInfo.tagName} (${clickableInfo.width}x${clickableInfo.height}px)`);
      console.log(`  │ Automation ID: ${clickableInfo.automationId}`);
      console.log(`  │ Center: (${Math.round(clickableInfo.centerX)}, ${Math.round(clickableInfo.centerY)})`);
      
      // Helper for delays (Puppeteer compatibility)
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Click the container to focus
      console.log(`  │ ACTION: Clicking container to focus...`);
      await this.page.mouse.click(clickableInfo.centerX, clickableInfo.centerY);
      await delay(100);
      
      // Now type the value - the focus should be on the date input
      console.log(`  │ ACTION: Typing value "${value}"...`);
      
      // Select all first to clear any existing value
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await delay(50);
      
      // Type the value
      await this.page.keyboard.type(String(value), { delay: 30 });
      await delay(100);
      
      // Tab to move to next field and validate
      await this.page.keyboard.press('Tab');
      await delay(100);
      
      // Verify the value was entered
      const finalValue = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.value : null;
      }, field.selector);
      
      console.log(`  │ Final value: "${finalValue}"`);
      
      if (finalValue === String(value)) {
        console.log(`  │ ✅ SUCCESS - Date field filled`);
        console.log(`  └─── END DEBUG ───\n`);
        return true;
      } else {
        // Try alternative approach: Use JavaScript to set value directly
        console.log(`  │ Direct click approach didn't work, trying JS injection...`);
        
        const jsResult = await this.page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          
          // Set value via JS
          el.value = val;
          
          // Dispatch events
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          
          return el.value === val;
        }, field.selector, String(value));
        
        if (jsResult) {
          console.log(`  │ ✅ SUCCESS - Value set via JS injection`);
          console.log(`  └─── END DEBUG ───\n`);
          return true;
        }
        
        console.log(`  │ ⚠️ Value mismatch: expected "${value}", got "${finalValue}"`);
        console.log(`  └─── END DEBUG ───\n`);
        return false;
      }
      
    } catch (error) {
      console.log(`  │ ❌ Error: ${error.message}`);
      console.log(`  └─── END DEBUG ───\n`);
      return false;
    }
  }

  // ============================================
  // FILE UPLOAD (keep our own - Workday doesn't have one)
  // ============================================

  async fillFile(field, resumePath) {
    if (!resumePath) return false;
    
    try {
      const btn = await this.page.$('[data-automation-id="select-files"]');
      if (btn) {
        const [chooser] = await Promise.all([
          this.page.waitForFileChooser({ timeout: 5000 }),
          btn.click()
        ]);
        await chooser.accept([resumePath]);
        return true;
      }
      
      const input = await this.page.$('input[type="file"]');
      if (input) {
        await input.uploadFile(resumePath);
        return true;
      }
      
      return false;
    } catch (e) {
      return false;
    }
  }
}

export default AIFormFiller;
