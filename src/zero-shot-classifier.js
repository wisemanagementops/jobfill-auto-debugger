// ============================================
// ZERO-SHOT FIELD CLASSIFIER
// Uses facebook/bart-large-mnli for true semantic understanding
// ============================================

import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set cache directory to local 'models' folder
const CACHE_DIR = path.join(__dirname, '..', 'models');
env.cacheDir = CACHE_DIR;

// Allow loading from local cache
env.allowLocalModels = true;

class ZeroShotFieldClassifier {
  constructor() {
    this.classifier = null;
    this.isLoaded = false;
    // DeBERTa-v3 is significantly better than BART for zero-shot classification
    // See: https://huggingface.co/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli
    this.modelName = 'Xenova/DeBERTa-v3-base-mnli-fever-anli';
    // Use full precision for best results
    this.quantized = false;
    // Hypothesis template - crucial for NLI-based classification
    this.hypothesisTemplate = 'This form field collects {}';
  }

  // ============================================
  // CANDIDATE LABELS FOR CLASSIFICATION
  // These work as hypothesis completions: "This form field collects {label}"
  // DeBERTa-v3 works best with natural language descriptions
  // ============================================
  
  static ALL_LABELS = [
    // Personal Info
    "a person's first name",
    "a person's middle name", 
    "a person's last name or surname",
    "an email address",
    
    // Address - More specific labels
    "address line 1 or street address",
    "address line 2 or apartment number",
    "the name of a city or town",
    "a state or province or region",
    "a postal code or zip code",
    "a country name",
    
    // Phone
    "a phone number",
    "the type of phone device like mobile or home",
    "a country phone code like +1",
    "a phone extension",
    
    // Employment
    "a LinkedIn profile URL",
    "whether the person previously worked at this company",
    "how the applicant heard about this job",
    "whether the person is authorized to work in this country",
    "whether the person requires visa sponsorship",
    
    // Education
    "the name of a school or university",
    "an academic degree level",
    "a field of study or major",
    
    // Demographics (EEO)
    "gender identity",
    "race or ethnicity information",
    "military veteran status",
    "disability status information",
    
    // Other
    "agreement to terms and conditions",
    "a signature or legal name",
    "a date",
    "a resume or CV file upload"
  ];
  
  // Hypothesis template for DeBERTa NLI
  static HYPOTHESIS_TEMPLATE = "This form field collects {}";

  // ============================================
  // LABEL TO PROFILE FIELD MAPPING
  // Maps classifier output to profile data
  // Updated to match hypothesis-style labels
  // ============================================
  static LABEL_TO_PROFILE = {
    // PRIMARY LABELS
    'first name of a person': {
      getValue: (p) => p.personal?.firstName,
      fieldTypes: ['text']
    },
    'last name or surname': {
      getValue: (p) => p.personal?.lastName,
      fieldTypes: ['text']
    },
    'email address': {
      getValue: (p) => p.personal?.email,
      fieldTypes: ['text']
    },
    'phone number': {
      getValue: (p) => p.personal?.phone?.replace(/[\(\)\-\s]/g, ''),
      fieldTypes: ['text']
    },
    'street address': {
      getValue: (p) => p.address?.line1,
      fieldTypes: ['text']
    },
    'city name': {
      getValue: (p) => p.address?.city,
      fieldTypes: ['text']
    },
    'state or region': {
      getValue: (p) => p.address?.state,
      fieldTypes: ['dropdown', 'text']
    },
    'postal or zip code': {
      getValue: (p) => p.address?.zipCode,
      fieldTypes: ['text']
    },
    'country name': {
      getValue: () => 'United States of America',
      fieldTypes: ['dropdown']
    },
    
    // SECONDARY LABELS
    'phone type like mobile or home': {
      getValue: () => 'Mobile',
      options: ['Mobile', 'Home Cellular', 'Cell', 'Personal', 'Home'],
      fieldTypes: ['dropdown']
    },
    'country calling code': {
      getValue: () => 'United States',
      searchValue: 'United States',
      fieldTypes: ['dropdown', 'searchable']
    },
    'linkedin profile url': {
      getValue: (p) => p.personal?.linkedIn,
      fieldTypes: ['text']
    },
    'previous employee question': {
      getValue: () => 'No',
      fieldTypes: ['radio', 'dropdown', 'checkboxGroup']
    },
    'job referral source': {
      getValue: () => 'LinkedIn',
      searchValue: 'LinkedIn',
      fieldTypes: ['dropdown', 'searchable', 'text']
    },
    'work authorization status': {
      getValue: (p) => p.workAuth?.authorizedToWork ? 'Yes' : 'No',
      fieldTypes: ['dropdown', 'radio', 'checkboxGroup']
    },
    'visa sponsorship requirement': {
      getValue: (p) => p.workAuth?.requiresSponsorship ? 'Yes' : 'No',
      fieldTypes: ['dropdown', 'radio', 'checkboxGroup']
    },
    
    // TERTIARY LABELS
    'school or university': {
      getValue: (p) => p.education?.school,
      fieldTypes: ['text', 'searchable']
    },
    'degree or education level': {
      getValue: (p) => {
        const d = (p.education?.degree || '').toLowerCase();
        if (d.includes('master')) return "Master's Degree";
        if (d.includes('bachelor')) return "Bachelor's Degree";
        if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
        if (d.includes('associate')) return "Associate's Degree";
        return p.education?.degree || "Bachelor's Degree";
      },
      fieldTypes: ['dropdown']
    },
    'field of study or major': {
      getValue: (p) => p.education?.fieldOfStudy,
      fieldTypes: ['text', 'searchable']
    },
    'gender identity': {
      getValue: (p) => p.eeo?.gender || 'Decline to Self Identify',
      fieldTypes: ['dropdown', 'radio']
    },
    'ethnicity or race': {
      getValue: (p) => p.eeo?.race || 'Decline to Self Identify',
      fieldTypes: ['dropdown', 'radio']
    },
    'veteran status': {
      getValue: (p) => {
        const s = (p.eeo?.veteranStatus || '').toLowerCase();
        if (s.includes('not') || !s) return 'I am not a protected veteran';
        return 'I identify as one or more';
      },
      fieldTypes: ['dropdown', 'radio']
    },
    'disability status': {
      getValue: (p) => {
        const s = (p.eeo?.disabilityStatus || '').toLowerCase();
        if (s.includes('yes')) return 'Yes, I have a disability';
        if (s.includes('prefer') || s.includes('not want')) return 'I do not want to answer';
        return 'No, I do not have a disability';
      },
      fieldTypes: ['dropdown', 'radio', 'checkboxGroup']
    },
    
    // OTHER LABELS
    'terms and agreement checkbox': {
      getValue: () => true,
      fieldTypes: ['checkbox']
    },
    'other or unknown field': {
      getValue: () => null,
      fieldTypes: ['any']
    }
  };

  // ============================================
  // LOAD MODEL
  // ============================================
  async loadModel() {
    if (this.isLoaded) return;
    
    console.log(`[ZeroShot] Loading model: ${this.modelName}`);
    console.log(`[ZeroShot] Cache directory: ${CACHE_DIR}`);
    
    // Check if model exists locally
    const fs = await import('fs');
    const modelExists = fs.existsSync(CACHE_DIR) && fs.readdirSync(CACHE_DIR).length > 0;
    
    if (modelExists) {
      console.log('[ZeroShot] Loading from local cache...');
    } else {
      console.log('[ZeroShot] Model not found locally. Downloading ~1.6GB (one-time)...');
      console.log('[ZeroShot] TIP: Run "npm run download-model" to pre-download with progress.');
    }
    
    const startTime = Date.now();
    
    // CRITICAL: Use quantized: false to load full precision model.onnx
    // The quantized model is too compressed and gives garbage results
    this.classifier = await pipeline('zero-shot-classification', this.modelName, {
      quantized: false,  // Use model.onnx (1.5GB) not model_quantized.onnx (392MB)
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          const loaded = progress.loaded || 0;
          const total = progress.total || 0;
          if (total > 0) {
            const pct = Math.round((loaded / total) * 100);
            const loadedMB = (loaded / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r[ZeroShot] Downloading: ${pct}% (${loadedMB}MB)    `);
          } else {
            process.stdout.write(`\r[ZeroShot] Downloading ${progress.file || ''}...    `);
          }
        }
      }
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[ZeroShot] Model loaded in ${elapsed}s`);
    
    this.isLoaded = true;
  }

  // ============================================
  // CLASSIFY A SINGLE FIELD
  // Uses DeBERTa-v3 with hypothesis template for better NLI
  // ============================================
  async classifyField(fieldContext, fieldType = 'text') {
    if (!this.isLoaded) {
      await this.loadModel();
    }

    // DeBERTa works best with hypothesis template
    // "This form field collects {label}"
    const result = await this.classifier(fieldContext, ZeroShotFieldClassifier.ALL_LABELS, {
      multi_label: false,
      hypothesis_template: ZeroShotFieldClassifier.HYPOTHESIS_TEMPLATE
    });
    
    return {
      label: result.labels[0],
      confidence: result.scores[0],
      allScores: result.labels.slice(0, 3).map((l, i) => ({ label: l, score: result.scores[i] }))
    };
  }

  // ============================================
  // CLASSIFY MULTIPLE FIELDS (BATCH)
  // ============================================
  async classifyFields(fields) {
    if (!this.isLoaded) {
      await this.loadModel();
    }

    const results = [];
    const totalFields = fields.length;
    
    console.log(`[ZeroShot] Classifying ${totalFields} fields...`);
    
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const context = this.buildFieldContext(field);
      
      process.stdout.write(`\r[ZeroShot] Processing field ${i + 1}/${totalFields}`);
      
      const classification = await this.classifyField(context, field.type);
      
      results.push({
        ...field,
        classification,
        profileMapping: ZeroShotFieldClassifier.LABEL_TO_PROFILE[classification.label]
      });
    }
    
    console.log(`\n[ZeroShot] Classification complete`);
    
    return results;
  }

  // ============================================
  // BUILD FIELD CONTEXT STRING FOR CLASSIFICATION
  // Creates a natural language description for the model
  // ============================================
  buildFieldContext(field) {
    const parts = [];
    
    // Start with the most important info - the label
    if (field.labelText && field.labelText.trim()) {
      // Clean up label - remove asterisks, trim
      const cleanLabel = field.labelText.replace(/\*/g, '').trim();
      parts.push(`This form field asks for: ${cleanLabel}`);
    }
    
    // Add field type context
    if (field.type === 'text') {
      parts.push('It is a text input field');
    } else if (field.type === 'dropdown') {
      parts.push('It is a dropdown selection');
    } else if (field.type === 'searchable') {
      parts.push('It is a searchable dropdown');
    } else if (field.type === 'checkbox') {
      parts.push('It is a checkbox');
    } else if (field.type === 'radio') {
      parts.push('It is a radio button choice');
    }
    
    // Add section context if available
    if (field.sectionHeader && field.sectionHeader.trim()) {
      parts.push(`Located in the "${field.sectionHeader}" section`);
    }
    
    // Add aria-label if different from label
    if (field.ariaLabel && field.ariaLabel !== field.labelText) {
      parts.push(`Description: ${field.ariaLabel}`);
    }
    
    // Add placeholder hint
    if (field.placeholder && field.placeholder.trim()) {
      parts.push(`Placeholder text: ${field.placeholder}`);
    }
    
    // If we have options (for dropdowns), include first few
    if (field.options && field.options.length > 0) {
      const optText = field.options.slice(0, 4).map(o => o.label || o).join(', ');
      parts.push(`Options include: ${optText}`);
    }
    
    // Fallback - use ID if no label
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

  // ============================================
  // GET RELEVANT LABELS FOR FIELD TYPE
  // ============================================
  getRelevantLabels(fieldType) {
    // For certain field types, we can narrow down the candidate labels
    // This improves accuracy by reducing false matches
    
    if (fieldType === 'checkbox') {
      return [
        'terms and conditions agreement',
        'background check consent',
        'age verification over 18',
        'require visa sponsorship',
        'authorized to work in united states',
        'disability status',
        'unknown field'
      ];
    }
    
    if (fieldType === 'radio') {
      return [
        'previous employee at this company',
        'authorized to work in united states',
        'require visa sponsorship',
        'gender identity',
        'veteran status',
        'disability status',
        'willing to relocate',
        'unknown field'
      ];
    }
    
    if (fieldType === 'datePicker') {
      return [
        'signature date',
        'graduation year',
        'available start date',
        'unknown field'
      ];
    }
    
    // For text and dropdown, use all labels
    return ZeroShotFieldClassifier.ALL_LABELS;
  }

  // ============================================
  // GET VALUE FOR A CLASSIFIED FIELD
  // ============================================
  getValueForField(classifiedField, profile) {
    const mapping = classifiedField.profileMapping;
    
    if (!mapping) {
      console.log(`[ZeroShot] No mapping for: ${classifiedField.classification.label}`);
      return null;
    }
    
    // Check if field type is compatible
    if (mapping.fieldTypes && !mapping.fieldTypes.includes('any')) {
      if (!mapping.fieldTypes.includes(classifiedField.type)) {
        console.log(`[ZeroShot] Type mismatch: ${classifiedField.type} not in ${mapping.fieldTypes.join(', ')}`);
        // Still try to get value, but flag this as potential issue
      }
    }
    
    const value = mapping.getValue(profile);
    
    return {
      value,
      options: mapping.options,
      searchValue: mapping.searchValue
    };
  }
}

export default ZeroShotFieldClassifier;
