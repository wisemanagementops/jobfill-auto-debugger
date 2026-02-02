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
      
      // Helper to get section header
      function getSection(el) {
        const section = el.closest('section, [role="group"], fieldset, [data-automation-id*="section"]');
        if (section) {
          const header = section.querySelector('h1, h2, h3, h4, legend, [data-automation-id="sectionHeader"]');
          if (header) return header.textContent.trim();
        }
        return '';
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
      
      // Address fields - ALWAYS override based on field label
      if (fieldLabelLower.includes('address line 1') || fieldIdLower.includes('addressline1')) {
        effectiveLabel = 'address line 1';
        console.log(`      📋 Override: address line 1 (field label match)`);
      } else if (fieldLabelLower.includes('address line 2') || fieldIdLower.includes('addressline2')) {
        effectiveLabel = 'address line 2';
        console.log(`      📋 Override: address line 2 (field label match)`);
      } else if (fieldLabelLower.includes('postal code') || fieldLabelLower.includes('zip code') || 
                 fieldIdLower.includes('postal') || fieldIdLower.includes('zipcode')) {
        effectiveLabel = 'postal code';
        console.log(`      📋 Override: postal code (field label match)`);
      } else if (fieldLabelLower.includes('country phone') || fieldIdLower.includes('countryphone') ||
                 fieldLabelLower.includes('phone code')) {
        effectiveLabel = 'country phone code';
        console.log(`      📋 Override: country phone code (field label match)`);
      } else if (classification.confidence < 0.50) {
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
    if (labelLower === 'gender') return p.eeo?.gender || 'Decline to Self Identify';
    if (labelLower === 'ethnicity') return p.eeo?.race || 'Decline to Self Identify';
    if (labelLower === 'veteran_status') return 'I am not a protected veteran';
    if (labelLower === 'disability_status') return 'I do not want to answer';
    
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
    if (labelLower === 'city' || labelLower.includes('city') || labelLower.includes('town')) {
      return p.address?.city;
    }
    if (labelLower === 'state' || labelLower.includes('state') || labelLower.includes('province') || labelLower.includes('region')) {
      return p.address?.state;
    }
    if (labelLower === 'postal code' || labelLower.includes('postal') || labelLower.includes('zip')) {
      return p.address?.zipCode;
    }
    if (labelLower.includes('country name') || (labelLower.includes('country') && !labelLower.includes('phone'))) {
      return 'United States of America';
    }
    
    // ========== WORK AUTHORIZATION ==========
    // Labels: "authorized to work in this country", "requires visa sponsorship", "previously worked at this company"
    if (labelLower.includes('authorized to work')) {
      return p.workAuth?.authorizedToWork ? 'Yes' : 'No';
    }
    if (labelLower.includes('visa sponsorship') || labelLower.includes('requires visa')) {
      return p.workAuth?.requiresSponsorship ? 'Yes' : 'No';
    }
    if (labelLower.includes('previously worked')) {
      return 'No';
    }
    
    // ========== REFERRAL SOURCE ==========
    // Label: "how the applicant heard about this job"
    if (labelLower.includes('heard about') || labelLower.includes('how') && labelLower.includes('job')) {
      return 'LinkedIn';
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
    
    // ========== EEO / DEMOGRAPHICS ==========
    // Labels: "gender identity", "race or ethnicity information", "military veteran status", "disability status"
    if (labelLower.includes('gender')) {
      return p.eeo?.gender || 'Decline to Self Identify';
    }
    if (labelLower.includes('race') || labelLower.includes('ethnicity')) {
      return p.eeo?.race || 'Decline to Self Identify';
    }
    if (labelLower.includes('veteran')) {
      const v = (p.eeo?.veteranStatus || '').toLowerCase();
      if (v.includes('not') || !v) return 'I am not a protected veteran';
      return p.eeo?.veteranStatus;
    }
    if (labelLower.includes('disability')) {
      const d = (p.eeo?.disabilityStatus || '').toLowerCase();
      if (d.includes('no') || !d) return 'No, I do not have a disability';
      if (d.includes('yes')) return 'Yes, I have a disability';
      return 'I do not want to answer';
    }
    
    // ========== AGREEMENTS ==========
    // Label: "agreement to terms and conditions"
    if (labelLower.includes('terms') || labelLower.includes('agreement')) {
      return true;
    }
    
    // ========== SIGNATURE / DATE ==========
    // Labels: "a signature or legal name", "a date"
    if (labelLower.includes('signature') || labelLower.includes('legal name')) {
      return `${p.personal?.firstName} ${p.personal?.lastName}`;
    }
    if (labelLower === 'a date') {
      // Return today's date in MM/DD/YYYY format
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
      
      switch (field.type) {
        case 'text':
          if (field.isSearchable) {
            result = await this.platform.fillSearchable(this.page, field.selector, value, label, this.classifier);
          } else {
            result = await this.platform.fillTextInput(this.page, field.selector, value, label);
          }
          break;
          
        case 'dropdown':
          result = await this.platform.fillDropdown(this.page, field.selector, value, label, this.classifier);
          break;
          
        case 'radio':
          result = await this.platform.fillRadio(this.page, field.selector, value, label);
          break;
          
        case 'checkbox':
          result = await this.platform.fillCheckbox(this.page, field.selector, value === true || value === 'true', label);
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
