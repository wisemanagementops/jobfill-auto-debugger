// ============================================
// WORKDAY PLATFORM v2.0 - Enhanced Selectors & Fill Logic
// Based on analyzed Workday HTML structure + semantic patterns
// ============================================

export const WorkdayPlatform = {
  name: 'workday',
  
  // URL patterns to detect Workday
  urlPatterns: [
    /myworkday(jobs)?\.com/i,
    /wd\d+\.myworkday/i,
    /workday\.com\/.*\/d\/jobs/i,
  ],

  // ============================================
  // STATIC SELECTORS - Known stable IDs
  // These are the exact selectors from your Workday.txt
  // ============================================
  selectors: {
    // Personal Information
    firstName: '#name--legalName--firstName',
    lastName: '#name--legalName--lastName',
    
    // Address
    addressLine1: '#address--addressLine1',
    city: '#address--city',
    postalCode: '#address--postalCode',
    state: '#address--countryRegion',           // Dropdown button
    country: '#country--country',                // Dropdown button
    
    // Phone
    phoneNumber: '#phoneNumber--phoneNumber',
    phoneExtension: '#phoneNumber--extension',
    phoneType: '#phoneNumber--phoneType',        // Dropdown button
    
    // Previous Worker (Radio buttons)
    previousWorker: 'input[name="candidateIsPreviousWorker"]',
    
    // How Did You Hear About Us (Searchable dropdown)
    source: '#source--source',
    
    // Skills (Searchable multi-select)
    skills: '#skills--skills',
    
    // EEO / Voluntary Self-Identification
    ethnicity: '#personalInfoUS--ethnicity',     // Dropdown button
    gender: '#personalInfoUS--gender',           // Dropdown button
    veteranStatus: '#personalInfoUS--veteranStatus', // Dropdown button
    
    // Disability Form
    disabilityName: '#selfIdentifiedDisabilityData--name',
    disabilityStatus: '#selfIdentifiedDisabilityData--disabilityStatus', // Checkbox group fieldset
    disabilityLanguage: '#selfIdentifiedDisabilityData--disabilityForm', // Dropdown
    disabilityEmployeeId: '#selfIdentifiedDisabilityData--employeeId',
    
    // Terms and Conditions
    termsCheckbox: '#termsAndConditions--acceptTermsAndAgreements',
    
    // Resume Upload
    resumeDropZone: '[data-automation-id="file-upload-drop-zone"]',
    resumeButton: '[data-automation-id="select-files"]',
    resumeButtonAlt: '#resumeAttachments--attachments',
    
    // LinkedIn / Social
    linkedIn: '#socialNetworkAccounts--linkedInAccount',
    
    // Websites (Add button)
    websitesAdd: '[data-automation-id="add-button"]',
  },

  // ============================================
  // DYNAMIC SELECTOR PATTERNS
  // For fields with variable IDs (education-1, education-5, etc.)
  // ============================================
  patterns: {
    // Education fields - index varies per application
    school: 'input[id*="education"][id*="school"]',
    degree: 'button[id*="education"][id*="degree"]',
    fieldOfStudy: 'input[id*="education"][id*="fieldOfStudy"]',
    educationAdd: 'button[data-automation-id="add-button"]',
    
    // Work Experience fields
    jobTitle: 'input[id*="workExperience"][id*="jobTitle"]',
    company: 'input[id*="workExperience"][id*="company"]',
    workExperienceAdd: 'button[data-automation-id="add-button"]',
    
    // Questionnaire fields (company-specific UUIDs)
    questionnaire: '[id*="Questionnaire"]',
    questionnaireCheckbox: 'fieldset[id*="Questionnaire"]',
    questionnaireDropdown: 'button[id*="Questionnaire"]',
    
    // Date fields
    dateYear: '[data-automation-id="dateSectionYear-display"]',
    dateMonth: '[data-automation-id="dateSectionMonth-display"]',
    dateDay: '[data-automation-id="dateSectionDay-display"]',
    
    // Generic searchable inputs
    searchable: 'input[data-uxi-widget-type="selectinput"]',
    searchableAlt: 'input[data-automation-id="searchBox"]',
  },

  // ============================================
  // ARIA-LABEL PATTERNS FOR SEMANTIC MATCHING
  // Use these when IDs are not available
  // ============================================
  ariaPatterns: {
    // Work Authorization
    workAuth: /aria-label.*authorized.*work/i,
    sponsorship: /aria-label.*(sponsor|visa|h-1b)/i,
    
    // Previous Employee
    previousEmployee: /aria-label.*(previous|former|worked.*before)/i,
    
    // EEO
    gender: /aria-label.*gender/i,
    ethnicity: /aria-label.*(ethnic|race)/i,
    veteran: /aria-label.*(veteran|military)/i,
    disability: /aria-label.*disability/i,
    
    // Location
    country: /aria-label.*country/i,
    state: /aria-label.*(state|province|region)/i,
    
    // Phone
    phoneType: /aria-label.*(phone.*type|device.*type)/i,
    phoneCode: /aria-label.*(country.*code|phone.*code|\+1)/i,
  },

  // ============================================
  // ELEMENT TYPE DETECTION
  // Maps Workday's unique DOM structure to field types
  // ============================================
  elementTypes: {
    // Text input
    textInput: {
      selector: 'input[type="text"]:not([data-uxi-widget-type])',
      cssClasses: ['css-1wl1chj'],
    },
    
    // Searchable dropdown (autocomplete)
    searchable: {
      selector: 'input[data-uxi-widget-type="selectinput"]',
      cssClasses: ['css-1giiucd', 'css-1jafa2r'],
      attributes: ['data-automation-id="searchBox"'],
    },
    
    // Dropdown button
    dropdown: {
      selector: 'button[aria-haspopup="listbox"]',
      cssClasses: ['css-t8rwff', 'css-1ai412s', 'css-1iw8903'],
    },
    
    // Radio button group
    radio: {
      selector: 'input[type="radio"]',
      cssClasses: ['css-19mapip', 'css-a42o2n'],
      containerClass: 'css-1ozzhrb',
    },
    
    // Checkbox
    checkbox: {
      selector: 'input[type="checkbox"]',
      cssClasses: ['css-1hhv9wx'],
    },
    
    // Checkbox group (fieldset with multiple checkboxes)
    checkboxGroup: {
      selector: 'fieldset[data-automation-id*="CheckboxGroup"]',
      cssClasses: ['css-y8lelu'],
    },
    
    // Add button (for lists like Work Experience, Education)
    addButton: {
      selector: 'button[data-automation-id="add-button"]',
      cssClasses: ['css-f176sn', 'css-134peqe'],
    },
    
    // File upload
    fileUpload: {
      selector: '[data-automation-id="file-upload-drop-zone"]',
      buttonSelector: '[data-automation-id="select-files"]',
    },
  },

  // ============================================
  // DROPDOWN OPTIONS - Multiple values to try
  // ============================================
  dropdownOptions: {
    phoneType: ['Mobile', 'Home Cellular', 'Cell', 'Home', 'Personal', 'Work'],
    country: ['United States of America', 'United States', 'USA', 'US'],
    countryPhoneCode: ['United States of America (+1)', 'United States (+1)', '+1'],
    
    // EEO options (may vary by company)
    gender: {
      male: ['Male', 'Man'],
      female: ['Female', 'Woman'],
      nonBinary: ['Non-Binary', 'Non Binary', 'Nonbinary'],
      decline: ['Decline to Self Identify', 'Prefer not to say', 'I do not wish to answer'],
    },
    ethnicity: {
      asian: ['Asian', 'Asian (Not Hispanic or Latino)'],
      black: ['Black or African American', 'Black or African American (Not Hispanic or Latino)'],
      hispanic: ['Hispanic or Latino', 'Hispanic/Latino'],
      white: ['White', 'White (Not Hispanic or Latino)', 'Caucasian'],
      twoOrMore: ['Two or More Races', 'Two or More Races (Not Hispanic or Latino)'],
      native: ['American Indian or Alaska Native'],
      pacific: ['Native Hawaiian or Other Pacific Islander'],
      decline: ['Decline to Self Identify', 'I do not wish to answer'],
    },
    veteranStatus: {
      notVeteran: ['I am not a protected veteran', 'Not a Veteran', 'No'],
      isVeteran: ['I identify as one or more of the classifications of protected veteran listed above', 'Yes'],
      decline: ["I don't wish to answer", 'I do not wish to answer'],
    },
    disabilityStatus: {
      yes: ['Yes, I have a disability, or have had one in the past', 'Yes, I have a disability'],
      no: ['No, I do not have a disability and have not had one in the past', 'No'],
      decline: ['I do not want to answer', 'I do not wish to answer'],
    },
    degree: {
      bachelors: ["Bachelor's Degree", "Bachelor's", 'Bachelors', 'BS', 'BA', 'B.S.', 'B.A.'],
      masters: ["Master's Degree", "Master's", 'Masters', 'MS', 'MA', 'M.S.', 'M.A.', 'MBA'],
      doctorate: ['Doctorate', 'PhD', 'Ph.D.', 'Doctor of Philosophy'],
      associates: ["Associate's Degree", "Associate's", 'Associates', 'AA', 'AS'],
      highSchool: ['High School or Equivalent', 'High School Diploma', 'GED'],
    },
    referralSource: ['LinkedIn', 'Indeed', 'Company Website', 'Glassdoor', 'Referral', 'Job Board', 'Career Fair'],
  },

  // ============================================
  // VALUE MAPPERS - Convert profile values to Workday format
  // ============================================
  mappers: {
    degree: (profileDegree) => {
      const d = (profileDegree || '').toLowerCase();
      if (d.includes('master') || d.includes('ms') || d.includes('mba')) return "Master's Degree";
      if (d.includes('bachelor') || d.includes('bs') || d.includes('ba')) return "Bachelor's Degree";
      if (d.includes('phd') || d.includes('doctor') || d.includes('doctorate')) return 'Doctorate';
      if (d.includes('associate')) return "Associate's Degree";
      if (d.includes('high school') || d.includes('ged')) return 'High School or Equivalent';
      return profileDegree || "Bachelor's Degree";
    },
    
    gender: (profileGender) => {
      const g = (profileGender || '').toLowerCase();
      if (g.includes('male') && !g.includes('female')) return 'Male';
      if (g.includes('female') || g.includes('woman')) return 'Female';
      if (g.includes('non') || g.includes('binary')) return 'Non-Binary';
      return 'Decline to Self Identify';
    },
    
    ethnicity: (profileEthnicity) => {
      const e = (profileEthnicity || '').toLowerCase();
      if (e.includes('asian')) return 'Asian';
      if (e.includes('black') || e.includes('african')) return 'Black or African American';
      if (e.includes('hispanic') || e.includes('latino') || e.includes('latina')) return 'Hispanic or Latino';
      if (e.includes('white') || e.includes('caucasian')) return 'White';
      if (e.includes('native') && e.includes('american')) return 'American Indian or Alaska Native';
      if (e.includes('pacific') || e.includes('hawaiian')) return 'Native Hawaiian or Other Pacific Islander';
      if (e.includes('two') || e.includes('multi') || e.includes('mixed')) return 'Two or More Races';
      return 'Decline to Self Identify';
    },
    
    veteranStatus: (profileVeteran) => {
      const v = (profileVeteran || '').toLowerCase();
      if (v.includes('not') || !v || v.includes('no')) return 'I am not a protected veteran';
      if (v.includes('yes') || v.includes('am a') || v.includes('identify')) {
        return 'I identify as one or more of the classifications of protected veteran listed above';
      }
      return "I don't wish to answer";
    },
    
    disabilityStatus: (profileDisability) => {
      const d = (profileDisability || '').toLowerCase();
      if (d.includes('yes') || d.includes('have a disability')) {
        return 'Yes, I have a disability, or have had one in the past';
      }
      if (d.includes('not want') || d.includes("don't want") || d.includes('prefer not') || d.includes('decline')) {
        return 'I do not want to answer';
      }
      return 'No, I do not have a disability and have not had one in the past';
    },
    
    phone: (profilePhone) => {
      if (!profilePhone) return '';
      // Remove country code, parentheses, dashes, spaces
      return profilePhone.replace(/^\+?1?\s*/, '').replace(/[\(\)\-\s]/g, '');
    },
    
    yesNo: (value) => {
      if (value === true || value === 'true' || value === 'yes' || value === 'Yes') return 'Yes';
      if (value === false || value === 'false' || value === 'no' || value === 'No') return 'No';
      return value;
    },
  },

  // ============================================
  // FILL FUNCTIONS - Interact with Workday DOM
  // ============================================
  
  /**
   * Fill a text input field
   */
  async fillTextInput(page, selector, value, label) {
    if (!value) return { success: false, skipped: true, reason: 'No value' };
    
    const result = await page.evaluate(async (sel, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      // Try multiple selector strategies
      let input = document.querySelector(sel);
      if (!input && sel.startsWith('#')) {
        input = document.getElementById(sel.slice(1));
      }
      
      if (!input) return { success: false, error: 'Element not found' };
      if (input.value === val) return { success: true, skipped: true, reason: 'Already filled' };
      
      // Workday requires proper event simulation
      input.focus();
      await sleep(50);
      
      // Clear existing value
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Type character by character for better compatibility
      for (const char of val) {
        input.value += char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(10);
      }
      
      // Trigger change and blur
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(50);
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(100);
      
      return { success: true, filled: val };
    }, selector, String(value));
    
    if (result.success && !result.skipped) {
      console.log(`  ✅ ${label}: "${value}"`);
    } else if (result.skipped) {
      console.log(`  ⏭️ ${label}: ${result.reason}`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Fill a dropdown (button that opens a listbox)
   */
  async fillDropdown(page, selector, values, label) {
    const valuesToTry = Array.isArray(values) ? values : [values];
    
    const result = await page.evaluate(async (sel, vals) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const btn = document.querySelector(sel);
      if (!btn) return { success: false, error: 'Dropdown not found' };
      
      // Check if already selected (not showing "Select One")
      const currentText = btn.textContent.toLowerCase().trim();
      for (const v of vals) {
        if (currentText.includes(v.toLowerCase()) && !currentText.includes('select')) {
          return { success: true, skipped: true, selected: btn.textContent.trim() };
        }
      }
      
      // Open dropdown
      btn.click();
      await sleep(400);
      
      // Find options
      const opts = document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
      if (!opts.length) {
        document.body.click(); // Close if no options
        return { success: false, error: 'No options found' };
      }
      
      // Try each value
      for (const v of vals) {
        const vLower = v.toLowerCase();
        for (const opt of opts) {
          const optText = opt.textContent?.toLowerCase().trim() || '';
          if (optText === vLower || optText.includes(vLower) || optText.startsWith(vLower.split(' ')[0])) {
            opt.click();
            await sleep(200);
            return { success: true, selected: opt.textContent?.trim() };
          }
        }
      }
      
      // No match found - close dropdown
      document.body.click();
      const optList = Array.from(opts).slice(0, 5).map(o => o.textContent?.trim()).join(', ');
      return { success: false, error: `No match for "${vals.join('/')}" in: ${optList}` };
    }, selector, valuesToTry);
    
    if (result.success && !result.skipped) {
      console.log(`  ✅ ${label}: "${result.selected}"`);
    } else if (result.skipped) {
      console.log(`  ⏭️ ${label}: Already set to "${result.selected}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Fill a searchable dropdown (type to search, then select)
   */
  async fillSearchable(page, selector, searchValue, label) {
    if (!searchValue) return { success: false, skipped: true, reason: 'No value' };
    
    const result = await page.evaluate(async (sel, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const input = document.querySelector(sel);
      if (!input) return { success: false, error: 'Searchable input not found' };
      
      // Check if already has a selection
      const container = input.closest('[data-uxi-widget-type]')?.parentElement || input.parentElement?.parentElement;
      const existingPill = container?.querySelector('[data-automation-id="selectedItem"]');
      if (existingPill?.textContent?.toLowerCase().includes(val.toLowerCase())) {
        return { success: true, skipped: true, selected: existingPill.textContent.trim() };
      }
      
      // Focus and type search value
      input.focus();
      await sleep(100);
      
      // Clear existing value first
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      
      // Type the search value
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(800); // Wait longer for search results
      
      // Find and click matching option
      const opts = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
      const valLower = val.toLowerCase();
      
      // Look for exact or partial match
      for (const opt of opts) {
        const optText = opt.textContent?.toLowerCase().trim() || '';
        if (optText.includes(valLower) || valLower.includes(optText) || optText.startsWith(valLower.split(' ')[0])) {
          opt.click();
          await sleep(200);
          return { success: true, selected: opt.textContent?.trim() };
        }
      }
      
      // DON'T fall back to first option - that causes wrong values!
      // Instead, return failure so we can handle it properly
      return { 
        success: false, 
        error: `No matching option for "${val}"`,
        availableOptions: Array.from(opts).slice(0, 5).map(o => o.textContent?.trim()).join(', ')
      };
    }, selector, String(searchValue));
    
    if (result.success && !result.skipped) {
      console.log(`  ✅ ${label}: "${result.selected}"`);
    } else if (result.skipped) {
      console.log(`  ⏭️ ${label}: Already set to "${result.selected}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
      if (result.availableOptions) {
        console.log(`      Available: ${result.availableOptions}`);
      }
    }
    
    return result;
  },

  /**
   * Fill a radio button group
   */
  async fillRadio(page, selector, value, label) {
    const result = await page.evaluate(async (sel, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      // Try multiple selector strategies for radio buttons
      let radios = document.querySelectorAll(sel);
      
      // If not found, try by name attribute
      if (!radios.length && sel.includes('name=')) {
        const name = sel.match(/name="([^"]+)"/)?.[1];
        if (name) radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
      }
      
      // Also try finding in a fieldset context
      if (!radios.length) {
        const fieldset = document.querySelector(`fieldset[id*="${sel.replace('#', '')}"]`) ||
                        document.querySelector(`[data-automation-id*="${sel.replace('#', '')}"]`);
        if (fieldset) radios = fieldset.querySelectorAll('input[type="radio"]');
      }
      
      if (!radios.length) return { success: false, error: 'Radio group not found' };
      
      const valLower = String(val).toLowerCase();
      const wantYes = ['yes', 'true', '1'].includes(valLower);
      const wantNo = ['no', 'false', '0'].includes(valLower);
      
      for (const radio of radios) {
        const lbl = radio.labels?.[0] || document.querySelector(`label[for="${radio.id}"]`);
        const lblText = (lbl?.textContent || '').toLowerCase().trim();
        const radioValue = (radio.value || '').toLowerCase();
        
        // Determine if this radio matches what we want
        const isYesOption = lblText === 'yes' || radioValue === 'yes' || radioValue === 'true';
        const isNoOption = lblText === 'no' || radioValue === 'no' || radioValue === 'false';
        
        if ((wantYes && isYesOption) || (wantNo && isNoOption)) {
          if (!radio.checked) {
            // Focus the radio first
            radio.focus();
            await sleep(50);
            
            // Click the radio
            radio.click();
            await sleep(100);
            
            // Also dispatch events that Workday might need
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            
            // Click the label too (some Workday forms respond better to label clicks)
            if (lbl) {
              lbl.click();
              await sleep(100);
            }
          }
          return { success: true, selected: wantYes ? 'Yes' : 'No', checked: radio.checked };
        }
      }
      
      return { success: false, error: 'No matching radio option', available: Array.from(radios).map(r => r.labels?.[0]?.textContent?.trim() || r.value).join(', ') };
    }, selector, String(value));
    
    if (result.success) {
      console.log(`  ✅ ${label}: "${result.selected}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
      if (result.available) console.log(`      Available: ${result.available}`);
    }
    
    return result;
  },

  /**
   * Fill a single checkbox
   */
  async fillCheckbox(page, selector, shouldCheck, label) {
    const result = await page.evaluate(async (sel, check) => {
      const cb = document.querySelector(sel);
      if (!cb) return { success: false, error: 'Checkbox not found' };
      
      const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
      if (isChecked !== check) {
        cb.click();
      }
      return { success: true, checked: check };
    }, selector, shouldCheck);
    
    if (result.success) {
      console.log(`  ✅ ${label}: ${result.checked ? 'checked' : 'unchecked'}`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Fill a checkbox group (like disability status)
   */
  async fillCheckboxGroup(page, selector, value, label) {
    const result = await page.evaluate(async (sel, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const fieldset = document.querySelector(sel);
      if (!fieldset) return { success: false, error: 'Checkbox group not found' };
      
      const checkboxes = fieldset.querySelectorAll('input[type="checkbox"]');
      const valLower = String(val).toLowerCase();
      
      // Determine what we're looking for
      const wantYes = valLower.includes('yes') || valLower.includes('have a disability');
      const wantNo = valLower.includes('no') && !valLower.includes('not want');
      const wantDecline = valLower.includes('not want') || valLower.includes("don't want") || valLower.includes('decline');
      
      for (const cb of checkboxes) {
        const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
        const lblText = lbl?.textContent?.toLowerCase().trim() || '';
        
        let shouldCheck = false;
        
        // Simple yes/no
        if (wantYes && (lblText === 'yes' || lblText.includes('yes, i have'))) shouldCheck = true;
        if (wantNo && (lblText === 'no' || lblText.includes('no, i do not'))) shouldCheck = true;
        if (wantDecline && lblText.includes('do not want to answer')) shouldCheck = true;
        
        if (shouldCheck && !cb.checked) {
          cb.click();
          await sleep(100);
          return { success: true, selected: lbl?.textContent?.trim() };
        }
      }
      
      return { success: false, error: 'No matching checkbox option' };
    }, selector, String(value));
    
    if (result.success) {
      console.log(`  ✅ ${label}: "${result.selected}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Fill the country phone code (special searchable field)
   */
  async fillCountryPhoneCode(page, label = 'Country Phone Code') {
    const result = await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      // Find searchable inputs near phone fields
      const inputs = document.querySelectorAll('input[data-uxi-widget-type="selectinput"]');
      
      for (const input of inputs) {
        const container = input.closest('[data-uxi-widget-type]')?.parentElement || input.parentElement?.parentElement;
        const parentText = container?.textContent?.toLowerCase() || '';
        
        // Check if this is the phone code field
        if (!parentText.includes('phone') && !parentText.includes('code') && !parentText.includes('+1')) {
          continue;
        }
        
        // Check if already has US selected
        const existingPill = container?.querySelector('[data-automation-id="selectedItem"]');
        if (existingPill?.textContent?.includes('United States') || existingPill?.textContent?.includes('+1')) {
          return { success: true, skipped: true, selected: existingPill.textContent.trim() };
        }
        
        // Type and search
        input.focus();
        input.value = 'United States';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(600);
        
        const opts = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
        for (const opt of opts) {
          if (opt.textContent?.includes('United States') || opt.textContent?.includes('+1')) {
            opt.click();
            await sleep(200);
            return { success: true, selected: opt.textContent?.trim() };
          }
        }
      }
      
      return { success: false, error: 'Phone code field not found' };
    });
    
    if (result.success && !result.skipped) {
      console.log(`  ✅ ${label}: "${result.selected}"`);
    } else if (result.skipped) {
      console.log(`  ⏭️ ${label}: Already set to "${result.selected}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Fill date picker (signature date, etc.)
   */
  async fillDatePicker(page, selector, label = 'Date') {
    const result = await page.evaluate(async (sel) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      
      // Find the date display element
      const display = document.querySelector(sel);
      if (!display) return { success: false, error: 'Date picker not found' };
      
      // Click to activate
      display.click();
      await sleep(300);
      
      // Find the active input
      const active = document.activeElement;
      if (active?.tagName === 'INPUT') {
        active.value = String(y);
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        active.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      return { success: true, date: `${m}/${d}/${y}` };
    }, selector);
    
    if (result.success) {
      console.log(`  ✅ ${label}: "${result.date}"`);
    } else {
      console.log(`  ❌ ${label}: ${result.error}`);
    }
    
    return result;
  },

  /**
   * Upload resume file
   */
  async uploadResume(page, resumePath, label = 'Resume') {
    if (!resumePath) {
      console.log(`  ⏭️ ${label}: No file path configured`);
      return { success: false, skipped: true };
    }
    
    try {
      // Try the primary button
      let btn = await page.$(this.selectors.resumeButton);
      if (!btn) {
        btn = await page.$(this.selectors.resumeButtonAlt);
      }
      
      if (btn) {
        const [chooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 5000 }),
          btn.click()
        ]);
        await chooser.accept([resumePath]);
        console.log(`  ✅ ${label}: Uploaded`);
        return { success: true };
      }
      
      // Fallback to generic file input
      const input = await page.$('input[type="file"]');
      if (input) {
        await input.uploadFile(resumePath);
        console.log(`  ✅ ${label}: Uploaded (fallback)`);
        return { success: true };
      }
      
      console.log(`  ⏭️ ${label}: No upload element found`);
      return { success: false, error: 'No upload element' };
      
    } catch (e) {
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  // ============================================
  // HELPER: Find field by semantic pattern
  // ============================================
  async findFieldByPattern(page, patternName) {
    const pattern = this.ariaPatterns[patternName];
    if (!pattern) return null;
    
    return await page.evaluate((patternStr) => {
      const regex = new RegExp(patternStr.slice(1, -1), 'i'); // Convert pattern string back to regex
      const elements = document.querySelectorAll('[aria-label]');
      
      for (const el of elements) {
        if (regex.test(el.getAttribute('aria-label'))) {
          return {
            selector: el.id ? `#${el.id}` : null,
            ariaLabel: el.getAttribute('aria-label'),
            tagName: el.tagName.toLowerCase(),
          };
        }
      }
      
      return null;
    }, pattern.toString());
  },
};

export default WorkdayPlatform;
