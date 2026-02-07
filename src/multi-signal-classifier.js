/**
 * Multi-Signal Field Classifier for Workday Forms
 * Version: 2.0.0
 * 
 * ARCHITECTURE: Field ID First + AI Fallback
 * ==========================================
 * 1. Field ID/Name Pattern (99% reliable - Workday IDs are semantic & consistent)
 * 2. Options Analysis (95% reliable - dropdown content is definitive)
 * 3. Label Keywords (85% reliable - explicit field labels)
 * 4. AI Classification (60-70% reliable - fallback for unknown fields)
 * 
 * NO fragile section text patterns - they don't scale.
 */

const CONFIG = {
  weights: {
    field_id: 0.99,    // Highest - Workday IDs are deterministic
    options: 0.95,     // High - dropdown content is definitive
    label: 0.85,       // Medium - explicit labels
    ai_stage1: 0.60,
    ai_stage2: 0.65,
  },
  thresholds: {
    ai_stage1: 0.45,
    ai_stage2: 0.60,
    agreement_bonus: 0.02,
  },
  logging: {
    signals: true,
    conflicts: true,
  }
};

// ============================================================================
// FIELD ID PATTERNS - The RELIABLE source of truth for Workday
// These are consistent across ALL Workday applications
// ============================================================================
const FIELD_ID_PATTERNS = [
  // Personal Information
  { pattern: /--firstName$/i, type: 'first_name' },
  { pattern: /legalName--firstName/i, type: 'first_name' },
  { pattern: /--lastName$/i, type: 'last_name' },
  { pattern: /legalName--lastName/i, type: 'last_name' },
  { pattern: /--middleName$/i, type: 'middle_name' },
  { pattern: /preferredName/i, type: 'preferred_name' },
  
  // Address
  { pattern: /--addressLine1$/i, type: 'address_line_1' },
  { pattern: /--addressLine2$/i, type: 'address_line_2' },
  { pattern: /--city$/i, type: 'city' },
  { pattern: /--postalCode$/i, type: 'postal_code' },
  { pattern: /--countryRegion$/i, type: 'state' },
  { pattern: /--country$/i, type: 'country' },
  
  // Phone
  { pattern: /--phoneNumber$/i, type: 'phone_number' },
  { pattern: /--countryPhoneCode$/i, type: 'country_phone_code' },
  { pattern: /--phoneExtension$/i, type: 'phone_extension' },
  { pattern: /phoneDeviceType/i, type: 'phone_device_type' },
  
  // Education
  { pattern: /--school$/i, type: 'school' },
  { pattern: /--fieldOfStudy$/i, type: 'field_of_study' },
  { pattern: /--degree$/i, type: 'degree' },
  { pattern: /--gpa$/i, type: 'gpa' },
  
  // EEO / Demographics
  { pattern: /personalInfoUS--gender$/i, type: 'gender' },
  { pattern: /--gender$/i, type: 'gender' },
  { pattern: /personalInfoUS--hispanicOrLatino$/i, type: 'hispanic_latino' },
  { pattern: /--hispanicOrLatino$/i, type: 'hispanic_latino' },
  { pattern: /personalInfoUS--veteranStatus$/i, type: 'veteran_status' },
  { pattern: /--veteranStatus$/i, type: 'veteran_status' },
  { pattern: /personalInfoUS--ethnicityMulti$/i, type: 'race_ethnicity' },
  { pattern: /--ethnicity/i, type: 'race_ethnicity' },
  
  // Disability Form
  { pattern: /selfIdentifiedDisabilityData--name$/i, type: 'disability_signature_name' },
  { pattern: /selfIdentifiedDisabilityData--disabilityStatus$/i, type: 'disability_status' },
  { pattern: /disabilityStatus$/i, type: 'disability_status' },
  { pattern: /dateSectionMonth/i, type: 'date_month' },
  { pattern: /dateSectionDay/i, type: 'date_day' },
  { pattern: /dateSectionYear/i, type: 'date_year' },
  { pattern: /dateSignedOn/i, type: 'signature_date' },
  
  // Questionnaire Fields - THE KEY PATTERNS
  { pattern: /previousWorker/i, type: 'previously_employed' },
  { pattern: /candidateIsPreviousWorker/i, type: 'previously_employed' },
  
  // Source
  { pattern: /--source$/i, type: 'referral_source' },
  { pattern: /source--source/i, type: 'referral_source' },
  
  // Documents
  { pattern: /resume/i, type: 'resume_upload' },
  { pattern: /coverLetter/i, type: 'cover_letter_upload' },
  
  // Skip
  { pattern: /employeeId/i, type: 'employee_id_skip' },
];

// ============================================================================
// LABEL PATTERNS - Direct keyword matching (backup for when ID doesn't help)
// ============================================================================
const LABEL_PATTERNS = [
  { pattern: /^first\s*name/i, type: 'first_name' },
  { pattern: /^last\s*name|^surname/i, type: 'last_name' },
  { pattern: /^phone\s*number(?!.*code)(?!.*country)/i, type: 'phone_number' },
  { pattern: /country\s*phone\s*code|phone\s*code/i, type: 'country_phone_code' },
  { pattern: /address\s*line\s*1|^street\s*address/i, type: 'address_line_1' },
  { pattern: /address\s*line\s*2/i, type: 'address_line_2' },
  { pattern: /^city$/i, type: 'city' },
  { pattern: /^state|^province/i, type: 'state' },
  { pattern: /postal\s*code|^zip/i, type: 'postal_code' },
  { pattern: /school|university/i, type: 'school' },
  { pattern: /field\s*of\s*study/i, type: 'field_of_study' },
  { pattern: /^degree/i, type: 'degree' },
  { pattern: /^gender/i, type: 'gender' },
  { pattern: /hispanic|latino/i, type: 'hispanic_latino' },
  { pattern: /^race|^ethnicity/i, type: 'race_ethnicity' },
  { pattern: /veteran/i, type: 'veteran_status' },
  { pattern: /disability/i, type: 'disability_status' },
  { pattern: /how\s*did\s*you\s*hear/i, type: 'referral_source' },
];

// ============================================================================
// OPTIONS SIGNATURES - Identify field type by dropdown content
// ============================================================================
const OPTIONS_SIGNATURES = {
  gender: { keywords: ['male', 'female', 'non-binary', 'decline to self-identify'], minMatches: 2 },
  veteran_status: { keywords: ['veteran', 'not a veteran', 'protected veteran', 'i am not a veteran'], minMatches: 1 },
  race_ethnicity: { keywords: ['asian', 'black', 'african american', 'white', 'pacific islander', 'native american'], minMatches: 2 },
  hispanic_latino: { keywords: ['hispanic', 'latino', 'not hispanic'], minMatches: 1 },
  disability_status: { keywords: ['disability', 'no disability', 'have a disability', 'do not wish'], minMatches: 1 },
  degree: { keywords: ['bachelor', 'master', 'doctorate', 'phd', 'associate', 'high school'], minMatches: 2 },
  us_state: { keywords: ['alabama', 'alaska', 'arizona', 'california', 'colorado', 'florida', 'georgia', 'oregon'], minMatches: 5 },
};

// ============================================================================
// MULTI-SIGNAL CLASSIFIER
// ============================================================================
class MultiSignalClassifier {
  constructor(stage1Classifier = null, stage2Classifier = null) {
    this.stage1Classifier = stage1Classifier;
    this.stage2Classifier = stage2Classifier;
    this.signalLog = [];
    this.stats = { totalFields: 0, byFieldId: 0, byLabel: 0, byOptions: 0, byAI: 0, conflicts: 0, fullAgreement: 0 };
  }
  
  async classifyField(field, options = {}) {
    this.stats.totalFields++;
    this.signalLog = [];
    const signals = [];
    
    // Get all possible identifiers
    const fieldId = field.id || '';
    const fieldName = field.name || '';  // Important for radio buttons!
    const fieldLabel = field.label || '';
    const fieldOptions = field.options || [];
    
    // ========================================
    // SIGNAL 1: Field ID/Name Pattern (MOST RELIABLE)
    // ========================================
    let idResult = this.classifyByFieldId(fieldId);
    if (!idResult && fieldName) {
      idResult = this.classifyByFieldId(fieldName);  // Try field.name for radio buttons
    }
    if (idResult) {
      signals.push({ 
        source: 'field_id', 
        type: idResult.type, 
        confidence: CONFIG.weights.field_id, 
        weight: CONFIG.weights.field_id,
        matchedPattern: idResult.pattern 
      });
      this.log('field_id', idResult.type, CONFIG.weights.field_id, idResult.pattern);
    }
    
    // ========================================
    // SIGNAL 2: Dropdown Options Analysis
    // ========================================
    if (fieldOptions && fieldOptions.length > 0) {
      const optionsResult = this.classifyByOptions(fieldOptions);
      if (optionsResult) {
        signals.push({ 
          source: 'options', 
          type: optionsResult.type, 
          confidence: CONFIG.weights.options, 
          weight: CONFIG.weights.options,
          matchedKeywords: optionsResult.matchedKeywords 
        });
        this.log('options', optionsResult.type, CONFIG.weights.options, optionsResult.matchedKeywords.join(', '));
      }
    }
    
    // ========================================
    // SIGNAL 3: Label Keywords
    // ========================================
    const labelResult = this.classifyByLabel(fieldLabel);
    if (labelResult) {
      signals.push({ 
        source: 'label', 
        type: labelResult.type, 
        confidence: CONFIG.weights.label, 
        weight: CONFIG.weights.label,
        matchedPattern: labelResult.pattern 
      });
      this.log('label', labelResult.type, CONFIG.weights.label, labelResult.pattern);
    }
    
    // ========================================
    // SIGNAL 4: AI Classification (FALLBACK)
    // ========================================
    if (options.runAI !== false && (this.stage1Classifier || this.stage2Classifier)) {
      const aiResult = await this.classifyWithAI(field, options.context || '');
      if (aiResult) {
        signals.push({ 
          source: 'ai', 
          type: aiResult.type, 
          confidence: aiResult.confidence, 
          weight: aiResult.weight,
          stage: aiResult.stage 
        });
        this.log('ai', aiResult.type, aiResult.confidence, 'Stage ' + aiResult.stage);
      }
    }
    
    // ========================================
    // RESOLVE SIGNALS
    // ========================================
    const result = this.resolveSignals(signals, field);
    result.signalLog = [...this.signalLog];
    return result;
  }
  
  classifyByFieldId(fieldId) {
    if (!fieldId) return null;
    for (const { pattern, type } of FIELD_ID_PATTERNS) {
      if (pattern.test(fieldId)) {
        return { type, pattern: pattern.toString() };
      }
    }
    // Try suffix extraction: "anything--gender" → "gender"
    const match = fieldId.match(/--([a-zA-Z]+)$/);
    if (match) {
      const suffix = match[1].toLowerCase();
      const suffixMap = { 
        'firstname': 'first_name', 
        'lastname': 'last_name', 
        'addressline1': 'address_line_1',
        'addressline2': 'address_line_2', 
        'postalcode': 'postal_code', 
        'phonenumber': 'phone_number', 
        'countryregion': 'state' 
      };
      if (suffixMap[suffix]) {
        return { type: suffixMap[suffix], pattern: 'ID suffix: ' + suffix };
      }
    }
    return null;
  }
  
  classifyByLabel(label) {
    if (!label) return null;
    const labelClean = label.replace(/\*/g, '').replace(/required/gi, '').replace(/select\s*one/gi, '').trim().toLowerCase();
    for (const { pattern, type } of LABEL_PATTERNS) {
      if (pattern.test(labelClean)) {
        return { type, pattern: pattern.toString() };
      }
    }
    return null;
  }
  
  classifyByOptions(options) {
    if (!options || options.length === 0) return null;
    const optionLabels = options.map(o => (typeof o === 'string' ? o : o.label || o.value || '').toLowerCase());
    const optionsText = optionLabels.join(' ');
    
    // Check for Yes/No (but don't return generic type - let Field ID determine the meaning)
    if (optionLabels.length === 2) {
      const sorted = [...optionLabels].sort();
      if (sorted[0] === 'no' && sorted[1] === 'yes') {
        // Don't return boolean_yes_no - it's too generic
        // The Field ID should tell us what KIND of yes/no question this is
        return null;
      }
    }
    
    // Check specific signatures
    for (const [type, signature] of Object.entries(OPTIONS_SIGNATURES)) {
      const matches = signature.keywords.filter(keyword => optionsText.includes(keyword.toLowerCase()));
      if (matches.length >= signature.minMatches) {
        return { type, matchedKeywords: matches };
      }
    }
    return null;
  }
  
  async classifyWithAI(field, context) {
    if (!this.stage1Classifier) return null;
    try {
      const aiContext = context || this.buildAIContext(field);
      const stage1Result = await this.stage1Classifier.classifyField(aiContext, field.type);
      
      if (stage1Result && stage1Result.confidence >= CONFIG.thresholds.ai_stage1) {
        return { type: stage1Result.label, confidence: stage1Result.confidence, weight: CONFIG.weights.ai_stage1, stage: 1 };
      }
      
      if (this.stage2Classifier) {
        if (!this.stage2Classifier.isLoaded) await this.stage2Classifier.loadModel();
        const stage2Result = await this.stage2Classifier.classifyField(aiContext);
        if (stage2Result && stage2Result.similarity >= CONFIG.thresholds.ai_stage2) {
          return { type: stage2Result.fieldType, confidence: stage2Result.similarity, weight: CONFIG.weights.ai_stage2, stage: 2 };
        }
      }
      
      if (stage1Result) {
        return { type: stage1Result.label, confidence: stage1Result.confidence, weight: stage1Result.confidence * CONFIG.weights.ai_stage1, stage: 1 };
      }
    } catch (error) { 
      console.warn('AI error:', error.message); 
    }
    return null;
  }
  
  buildAIContext(field) {
    const parts = [];
    if (field.label) parts.push('Field: "' + field.label.replace(/\*/g, '').trim() + '"');
    if (field.id) {
      const hints = field.id.split(/--|__|-|_/)
        .filter(s => s.length > 2 && !/^[a-f0-9]{8,}$/i.test(s))
        .map(s => s.replace(/([A-Z])/g, ' $1').toLowerCase().trim())
        .filter(s => s.length > 2);
      if (hints.length > 0) parts.push('Hints: ' + hints.join(', '));
    }
    if (field.section) parts.push('Context: "' + field.section.substring(0, 150) + '"');
    if (field.options && field.options.length > 0 && field.options.length <= 8) {
      const optLabels = field.options.map(o => typeof o === 'string' ? o : o.label || o).slice(0, 6).join(', ');
      parts.push('Options: [' + optLabels + ']');
    }
    return parts.join('. ');
  }
  
  resolveSignals(signals, field) {
    if (signals.length === 0) {
      return { type: null, confidence: 0, agreement: 'none', source: 'none', message: 'No signals' };
    }
    
    // Group by type
    const votes = {};
    for (const signal of signals) {
      if (!votes[signal.type]) {
        votes[signal.type] = { type: signal.type, totalWeight: 0, sources: [], maxConfidence: 0 };
      }
      votes[signal.type].totalWeight += signal.weight;
      votes[signal.type].sources.push(signal.source);
      votes[signal.type].maxConfidence = Math.max(votes[signal.type].maxConfidence, signal.confidence);
    }
    
    const sorted = Object.values(votes).sort((a, b) => b.totalWeight - a.totalWeight);
    const winner = sorted[0];
    const uniqueTypes = Object.keys(votes);
    
    let agreement, confidence;
    if (uniqueTypes.length === 1) {
      agreement = 'full';
      confidence = Math.min(0.99, winner.maxConfidence + CONFIG.thresholds.agreement_bonus * winner.sources.length);
      this.stats.fullAgreement++;
    } else if (winner.sources.length >= signals.length / 2) {
      agreement = 'majority';
      confidence = winner.maxConfidence;
    } else {
      agreement = 'conflict';
      confidence = winner.totalWeight / signals.reduce((sum, s) => sum + s.weight, 0);
      this.stats.conflicts++;
      if (CONFIG.logging.conflicts) {
        console.log('  ⚠️ Conflict for "' + field.label + '":');
        sorted.forEach(v => console.log('     ' + v.type + ': ' + v.sources.join(' + ') + ' (weight: ' + v.totalWeight.toFixed(2) + ')'));
      }
    }
    
    // Update stats
    if (winner.sources.includes('field_id')) this.stats.byFieldId++;
    else if (winner.sources.includes('options')) this.stats.byOptions++;
    else if (winner.sources.includes('label')) this.stats.byLabel++;
    else if (winner.sources.includes('ai')) this.stats.byAI++;
    
    return {
      type: winner.type,
      confidence,
      agreement,
      sources: winner.sources,
      primarySource: winner.sources[0],
      allSignals: signals,
      conflict: uniqueTypes.length > 1 ? sorted.map(v => ({ type: v.type, sources: v.sources })) : null,
    };
  }
  
  log(source, type, confidence, details) {
    if (CONFIG.logging.signals) {
      this.signalLog.push({ source, type, confidence, details });
    }
  }
  
  getStats() { return { ...this.stats }; }
  
  resetStats() {
    this.stats = { totalFields: 0, byFieldId: 0, byLabel: 0, byOptions: 0, byAI: 0, conflicts: 0, fullAgreement: 0 };
  }
  
  printStats() {
    const s = this.stats;
    console.log('\n📊 Multi-Signal Classification Statistics:');
    console.log('   Total Fields: ' + s.totalFields);
    console.log('   By Field ID:  ' + s.byFieldId + ' (' + ((s.byFieldId/s.totalFields*100)||0).toFixed(1) + '%)');
    console.log('   By Options:   ' + s.byOptions + ' (' + ((s.byOptions/s.totalFields*100)||0).toFixed(1) + '%)');
    console.log('   By Label:     ' + s.byLabel + ' (' + ((s.byLabel/s.totalFields*100)||0).toFixed(1) + '%)');
    console.log('   By AI:        ' + s.byAI + ' (' + ((s.byAI/s.totalFields*100)||0).toFixed(1) + '%)');
    console.log('   Full Agreement: ' + s.fullAgreement);
    console.log('   Conflicts:    ' + s.conflicts);
  }
}

export { MultiSignalClassifier, CONFIG, FIELD_ID_PATTERNS, LABEL_PATTERNS, OPTIONS_SIGNATURES };
export default MultiSignalClassifier;
