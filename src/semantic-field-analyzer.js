// Semantic Field Analyzer
// Uses context-aware classification to understand what each field is asking for
// and resolves the appropriate answer from profile or generates it dynamically

export class SemanticFieldAnalyzer {
  constructor(profile) {
    this.profile = profile;
    
    // Date type patterns - what context suggests each date type
    this.datePatterns = {
      TODAY: {
        keywords: ['signature', 'signed', 'today', 'current', 'form date', 'acknowledgment', 'consent', 'agreement'],
        sectionHints: ['disability', 'self-identification', 'terms', 'authorization', 'consent'],
        resolver: () => this.formatDate(new Date())
      },
      DATE_OF_BIRTH: {
        keywords: ['birth', 'dob', 'born', 'birthday', 'date of birth', 'birthdate'],
        sectionHints: ['personal', 'demographic'],
        resolver: () => this.profile.personal?.dateOfBirth || ''
      },
      GRADUATION: {
        keywords: ['graduation', 'graduated', 'completion', 'degree', 'diploma'],
        sectionHints: ['education', 'academic', 'school', 'university'],
        resolver: () => this.profile.education?.graduationYear || ''
      },
      EMPLOYMENT_START: {
        keywords: ['start date', 'began', 'joined', 'hired', 'from date', 'employment start'],
        sectionHints: ['work experience', 'employment', 'job history'],
        resolver: () => this.profile.employment?.startDate || ''
      },
      EMPLOYMENT_END: {
        keywords: ['end date', 'left', 'departure', 'to date', 'employment end', 'last day'],
        sectionHints: ['work experience', 'employment'],
        resolver: () => this.profile.employment?.endDate || ''
      },
      AVAILABLE_START: {
        keywords: ['available', 'can start', 'earliest start', 'availability', 'when can you'],
        sectionHints: ['preferences', 'availability'],
        resolver: () => this.profile.employment?.availableStartDate || 'Immediately'
      },
      VISA_EXPIRY: {
        keywords: ['expir', 'valid until', 'visa date', 'authorization expir'],
        sectionHints: ['work authorization', 'visa', 'immigration'],
        resolver: () => this.profile.workAuth?.visaExpiry || ''
      }
    };

    // Question category patterns
    this.questionPatterns = {
      // Work Authorization
      WORK_AUTHORIZATION: {
        keywords: ['authorized to work', 'legally authorized', 'legal right to work', 'eligible to work', 'work permit'],
        answer: () => this.profile.workAuth?.authorizedToWork ? 'Yes' : 'No'
      },
      SPONSORSHIP: {
        keywords: ['sponsorship', 'sponsor', 'visa sponsor', 'require sponsor', 'need sponsor', 'h-1b', 'h1b'],
        answer: () => this.profile.workAuth?.requiresSponsorship ? 'Yes' : 'No'
      },
      ITAR_EAR: {
        keywords: ['itar', 'ear', 'export control', 'us person', 'export regulation'],
        // H1B holders are NOT US Persons for ITAR
        answer: () => {
          const status = this.profile.workAuth?.visaStatus?.toLowerCase() || '';
          const isUSPerson = ['citizen', 'green card', 'permanent resident', 'asylee', 'refugee'].some(s => status.includes(s));
          return isUSPerson ? 'Yes' : 'No';
        }
      },

      // Personal/EEO
      GENDER: {
        keywords: ['gender', 'sex', 'male', 'female'],
        answer: () => this.profile.eeo?.gender || 'Prefer not to say'
      },
      ETHNICITY: {
        keywords: ['ethnicity', 'race', 'ethnic', 'racial'],
        answer: () => this.profile.eeo?.race || 'Prefer not to say'
      },
      VETERAN: {
        keywords: ['veteran', 'military', 'armed forces', 'served'],
        answer: () => this.profile.eeo?.veteranStatus || 'I am not a veteran'
      },
      DISABILITY: {
        keywords: ['disability', 'disabled', 'handicap', 'impairment'],
        answer: () => this.profile.eeo?.disabilityStatus || 'No'
      },

      // Employment
      PREVIOUS_EMPLOYEE: {
        keywords: ['previously worked', 'former employee', 'worked here before', 'past employee', 'previously employed'],
        answer: () => this.profile.additional?.previouslyEmployed ? 'Yes' : 'No'
      },
      YEARS_EXPERIENCE: {
        keywords: ['years of experience', 'years experience', 'how many years', 'total experience'],
        answer: () => this.profile.employment?.yearsOfExperience || ''
      },
      SALARY: {
        keywords: ['salary', 'compensation', 'pay', 'wage', 'expected salary', 'desired salary'],
        answer: () => this.profile.employment?.desiredSalary || ''
      },
      RELOCATE: {
        keywords: ['relocate', 'relocation', 'willing to move', 'open to relocation'],
        answer: () => this.profile.employment?.willingToRelocate ? 'Yes' : 'No'
      },

      // Legal
      OVER_18: {
        keywords: ['18 years', 'over 18', 'at least 18', 'legal age', 'adult'],
        answer: () => this.profile.additional?.over18 ? 'Yes' : 'No'
      },
      CRIMINAL: {
        keywords: ['felony', 'convicted', 'criminal', 'misdemeanor', 'crime'],
        answer: () => this.profile.additional?.criminalHistory ? 'Yes' : 'No'
      },
      BACKGROUND_CHECK: {
        keywords: ['background check', 'background investigation', 'consent to background'],
        answer: () => 'Yes' // Usually we want to consent
      },
      DRUG_TEST: {
        keywords: ['drug test', 'drug screen', 'substance test'],
        answer: () => 'Yes'
      },

      // Referral
      HOW_DID_YOU_HEAR: {
        keywords: ['how did you hear', 'where did you', 'learn about', 'source', 'referral'],
        answer: () => this.profile.referral?.source || 'LinkedIn'
      },
      REFERRER_NAME: {
        keywords: ['referrer name', 'referred by', 'employee referral', 'who referred'],
        answer: () => this.profile.referral?.referrerName || ''
      }
    };
  }

  // Format date as MM/DD/YYYY or YYYY-MM-DD depending on context
  formatDate(date, format = 'US') {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    if (format === 'ISO') {
      return `${year}-${month}-${day}`;
    }
    return `${month}/${day}/${year}`;
  }

  // Analyze a field and determine what it's asking for
  analyzeField(fieldInfo) {
    const { label, id, name, ariaLabel, placeholder, sectionHeader, fieldType } = fieldInfo;
    
    // Combine all text for analysis
    const fullContext = [label, id, name, ariaLabel, placeholder, sectionHeader]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // Check if it's a date field
    if (fieldType === 'date' || fullContext.includes('date') || fullContext.includes('yyyy') || fullContext.includes('mm/dd')) {
      return this.classifyDateField(fullContext, sectionHeader);
    }

    // Check question patterns
    for (const [category, pattern] of Object.entries(this.questionPatterns)) {
      for (const keyword of pattern.keywords) {
        if (fullContext.includes(keyword.toLowerCase())) {
          return {
            category,
            answer: pattern.answer(),
            confidence: 0.9,
            reasoning: `Matched keyword "${keyword}"`
          };
        }
      }
    }

    // Try to match common field names
    return this.matchCommonField(fullContext, fieldInfo);
  }

  // Classify what type of date is being asked for
  classifyDateField(context, sectionHeader) {
    const sectionLower = (sectionHeader || '').toLowerCase();
    
    for (const [dateType, pattern] of Object.entries(this.datePatterns)) {
      // Check keywords in context
      for (const keyword of pattern.keywords) {
        if (context.includes(keyword.toLowerCase())) {
          return {
            category: 'DATE',
            subtype: dateType,
            answer: pattern.resolver(),
            confidence: 0.95,
            reasoning: `Date field matched keyword "${keyword}"`
          };
        }
      }
      
      // Check section hints
      for (const hint of pattern.sectionHints) {
        if (sectionLower.includes(hint.toLowerCase()) || context.includes(hint.toLowerCase())) {
          return {
            category: 'DATE',
            subtype: dateType,
            answer: pattern.resolver(),
            confidence: 0.8,
            reasoning: `Date field in section suggesting "${dateType}"`
          };
        }
      }
    }

    // Default: if it's on a form/agreement page, assume today's date
    if (context.includes('sign') || context.includes('agree') || context.includes('acknowledge')) {
      return {
        category: 'DATE',
        subtype: 'TODAY',
        answer: this.formatDate(new Date()),
        confidence: 0.7,
        reasoning: 'Date field appears to be for form signature'
      };
    }

    return {
      category: 'DATE',
      subtype: 'UNKNOWN',
      answer: null,
      confidence: 0.3,
      reasoning: 'Could not determine date type'
    };
  }

  // Match common field patterns
  matchCommonField(context, fieldInfo) {
    const commonFields = {
      'first name': () => this.profile.personal?.firstName,
      'last name': () => this.profile.personal?.lastName,
      'middle name': () => this.profile.personal?.middleName || '',
      'email': () => this.profile.personal?.email,
      'phone': () => this.profile.personal?.phone,
      'address': () => this.profile.address?.line1,
      'city': () => this.profile.address?.city,
      'state': () => this.profile.address?.state,
      'zip': () => this.profile.address?.zipCode,
      'postal': () => this.profile.address?.zipCode,
      'country': () => this.profile.address?.country || 'United States',
      'linkedin': () => this.profile.personal?.linkedIn,
      'website': () => this.profile.personal?.website,
      'school': () => this.profile.education?.school,
      'university': () => this.profile.education?.school,
      'degree': () => this.profile.education?.degree,
      'field of study': () => this.profile.education?.fieldOfStudy,
      'major': () => this.profile.education?.fieldOfStudy,
      'gpa': () => this.profile.education?.gpa,
    };

    for (const [pattern, resolver] of Object.entries(commonFields)) {
      if (context.includes(pattern)) {
        return {
          category: 'COMMON_FIELD',
          subtype: pattern.toUpperCase().replace(' ', '_'),
          answer: resolver(),
          confidence: 0.85,
          reasoning: `Matched common field pattern "${pattern}"`
        };
      }
    }

    return {
      category: 'UNKNOWN',
      answer: null,
      confidence: 0,
      reasoning: 'No pattern matched'
    };
  }

  // Analyze dropdown options to find best match
  findBestOption(options, targetValue) {
    if (!options || options.length === 0) return null;
    
    const target = targetValue.toLowerCase().trim();
    
    // Exact match
    for (const opt of options) {
      if (opt.toLowerCase().trim() === target) {
        return opt;
      }
    }
    
    // Contains match
    for (const opt of options) {
      const optLower = opt.toLowerCase();
      if (optLower.includes(target) || target.includes(optLower.split('(')[0].trim())) {
        return opt;
      }
    }
    
    // Fuzzy match - first word
    const firstWord = target.split(' ')[0];
    for (const opt of options) {
      if (opt.toLowerCase().startsWith(firstWord)) {
        return opt;
      }
    }
    
    // Yes/No matching with variations
    if (['yes', 'no', 'true', 'false'].includes(target)) {
      const wantYes = ['yes', 'true'].includes(target);
      for (const opt of options) {
        const optLower = opt.toLowerCase().trim();
        if (wantYes && (optLower === 'yes' || optLower.startsWith('yes'))) return opt;
        if (!wantYes && (optLower === 'no' || optLower.startsWith('no'))) return opt;
      }
    }

    return null;
  }
}

export default SemanticFieldAnalyzer;
