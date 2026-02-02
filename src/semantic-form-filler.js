// ============================================
// SEMANTIC FORM FILLER v2.0
// Uses Hybrid Classification (Zero-Shot + Semantic Similarity) for maximum accuracy
// Models:
//   - Zero-shot: MoritzLaurer/deberta-v3-large-zeroshot-v2.0 (435M params)
//   - Embeddings: Xenova/bge-m3 (568M params, MTEB ~65)
// ============================================

import HybridFieldClassifier from './hybrid-field-classifier.js';

export class SemanticFormFiller {
  constructor(page, profile) {
    this.page = page;
    this.profile = profile;
    this.classifier = new HybridFieldClassifier({
      confidenceThreshold: 0.45,  // Zero-shot confidence threshold
      similarityThreshold: 0.6,   // Semantic similarity fallback threshold
    });
    this.filled = 0;
    this.failed = 0;
    this.skipped = 0;
    // Note: Confidence threshold is now handled by the hybrid classifier internally
    // Fields below 45% zero-shot confidence automatically fall through to semantic similarity
    this.confidenceThreshold = 0.35; // Lower final threshold since hybrid is more accurate
  }

  // ============================================
  // MAIN ENTRY POINT
  // ============================================
  async fillAllFields() {
    console.log('🔄 [SemanticFiller] Starting hybrid transformer-based form analysis...');
    console.log('🔄 [SemanticFiller] Using: DeBERTa-v3-large (zero-shot) + BGE-M3 (semantic similarity)');
    
    this.filled = 0;
    this.failed = 0;
    this.skipped = 0;

    try {
      // Step 1: Load both transformer models (cached after first run)
      await this.classifier.loadModels();

      // Step 2: Discover all fields on the page
      const fields = await this.discoverAllFields();
      console.log(`[SemanticFiller] 🔍 Discovered ${fields.length} interactive fields`);

      if (fields.length === 0) {
        console.log('[SemanticFiller] No fields found on page');
        return { filled: 0, failed: 0, skipped: 0 };
      }

      // Step 3: Classify all fields using transformer
      const classifiedFields = await this.classifier.classifyFields(fields);

      // Step 4: Log classifications for debugging
      console.log('\n[SemanticFiller] 📋 Field Classifications:');
      for (const field of classifiedFields) {
        const conf = (field.classification.confidence * 100).toFixed(1);
        const method = field.classification.method || 'zero-shot';
        const methodIcon = method === 'zero-shot' ? '🎯' : method === 'semantic-similarity' ? '🔍' : '⚠️';
        console.log(`  ${methodIcon} "${field.labelText || field.id}" → ${field.classification.label} (${conf}% via ${method})`);
      }
      console.log('');

      // Step 5: Fill each classified field
      for (const field of classifiedFields) {
        await this.fillClassifiedField(field);
      }

      // Step 6: Handle resume upload
      await this.uploadResume();

    } catch (error) {
      console.log(`[SemanticFiller] ❌ Error: ${error.message}`);
      console.error(error.stack);
    }

    console.log(`\n📊 [SemanticFiller] Results: ✅ filled=${this.filled}, ❌ failed=${this.failed}, ⏭️ skipped=${this.skipped}`);
    
    return {
      filled: this.filled,
      failed: this.failed,
      skipped: this.skipped
    };
  }

  // ============================================
  // DISCOVER ALL FIELDS ON PAGE
  // ============================================
  async discoverAllFields() {
    return await this.page.evaluate(() => {
      const fields = [];

      // Helper: Check if element is visible
      function isVisible(el) {
        if (!el.offsetParent && el.tagName !== 'BODY') return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }

      // Helper: Check if already filled
      function isFilled(el) {
        if (el.tagName === 'INPUT') {
          if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
          return el.value && el.value.trim().length > 0;
        }
        if (el.tagName === 'BUTTON') {
          const text = el.textContent.toLowerCase().trim();
          return text !== '' && !text.includes('select') && text !== 'select one';
        }
        return false;
      }

      // Helper: Get label text for an element
      function getLabelText(el) {
        // 1. Check for associated label
        if (el.labels && el.labels.length > 0) {
          return el.labels[0].textContent.trim();
        }
        
        // 2. Check for label with matching for attribute
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) return label.textContent.trim();
        }
        
        // 3. Check aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelEl = document.getElementById(labelledBy);
          if (labelEl) return labelEl.textContent.trim();
        }
        
        // 4. Look for nearby label in parent
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 5) {
          const label = parent.querySelector('label');
          if (label && !label.htmlFor) {
            return label.textContent.trim();
          }
          
          // Check for Workday-style labels
          const wdLabel = parent.querySelector('[data-automation-id*="label"], [class*="label"]');
          if (wdLabel && wdLabel !== el) {
            return wdLabel.textContent.trim();
          }
          
          parent = parent.parentElement;
          depth++;
        }
        
        return '';
      }

      // Helper: Get section header
      function getSectionHeader(el) {
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 10) {
          const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, legend, [data-automation-id*="section"]');
          if (heading) {
            return heading.textContent.trim();
          }
          parent = parent.parentElement;
          depth++;
        }
        return '';
      }

      // ========== FIND TEXT INPUTS ==========
      document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])').forEach(el => {
        if (!isVisible(el) || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return;
        
        const isSearchable = el.getAttribute('data-uxi-widget-type') === 'selectinput' || 
                            el.getAttribute('data-automation-id') === 'searchBox' ||
                            el.getAttribute('autocomplete') === 'off';
        
        fields.push({
          type: isSearchable ? 'searchable' : 'text',
          selector: el.id ? `#${CSS.escape(el.id)}` : null,
          id: el.id,
          name: el.name,
          labelText: getLabelText(el),
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.placeholder || '',
          sectionHeader: getSectionHeader(el),
          filled: isFilled(el),
          currentValue: el.value,
          required: el.required || el.getAttribute('aria-required') === 'true'
        });
      });

      // ========== FIND DROPDOWN BUTTONS (Workday style) ==========
      document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(el => {
        if (!isVisible(el)) return;
        
        fields.push({
          type: 'dropdown',
          selector: el.id ? `#${CSS.escape(el.id)}` : null,
          id: el.id,
          name: el.name,
          labelText: getLabelText(el),
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: '',
          sectionHeader: getSectionHeader(el),
          filled: isFilled(el),
          currentValue: el.textContent.trim(),
          required: el.getAttribute('aria-required') === 'true'
        });
      });

      // ========== FIND CHECKBOXES ==========
      document.querySelectorAll('input[type="checkbox"]').forEach(el => {
        if (!isVisible(el)) return;
        
        // Skip if part of a checkbox group (handled separately)
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const groupCheckboxes = fieldset.querySelectorAll('input[type="checkbox"]');
          if (groupCheckboxes.length > 1) return; // Part of group, skip individual
        }
        
        fields.push({
          type: 'checkbox',
          selector: el.id ? `#${CSS.escape(el.id)}` : null,
          id: el.id,
          name: el.name,
          labelText: getLabelText(el),
          ariaLabel: el.getAttribute('aria-label') || '',
          sectionHeader: getSectionHeader(el),
          filled: el.checked,
          required: el.required || el.getAttribute('aria-required') === 'true'
        });
      });

      // ========== FIND RADIO BUTTON GROUPS ==========
      const radioGroups = new Map();
      document.querySelectorAll('input[type="radio"]').forEach(el => {
        if (!isVisible(el)) return;
        
        const name = el.name;
        if (!name) return;
        
        if (!radioGroups.has(name)) {
          radioGroups.set(name, {
            type: 'radio',
            name: name,
            selector: `input[type="radio"][name="${name}"]`,
            labelText: getLabelText(el),
            ariaLabel: el.getAttribute('aria-label') || '',
            sectionHeader: getSectionHeader(el),
            options: [],
            filled: false
          });
        }
        
        const group = radioGroups.get(name);
        const optionLabel = el.labels?.[0]?.textContent?.trim() || 
                          document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || 
                          el.value;
        
        group.options.push({
          value: el.value,
          label: optionLabel
        });
        
        if (el.checked) group.filled = true;
      });
      
      radioGroups.forEach(group => fields.push(group));

      // ========== FIND CHECKBOX GROUPS (Yes/No questions) ==========
      document.querySelectorAll('fieldset').forEach(fs => {
        if (!isVisible(fs)) return;
        
        const checkboxes = fs.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length < 2 || checkboxes.length > 4) return;
        
        const options = Array.from(checkboxes).map(cb => {
          const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
          return {
            label: lbl?.textContent?.trim() || '',
            checked: cb.checked
          };
        });
        
        // Check if this looks like a question (has Yes/No or similar)
        const hasYesNo = options.some(o => o.label.toLowerCase() === 'yes' || o.label.toLowerCase() === 'no');
        
        if (hasYesNo || checkboxes.length <= 4) {
          fields.push({
            type: 'checkboxGroup',
            selector: fs.id ? `#${CSS.escape(fs.id)}` : `fieldset[data-automation-id="${fs.getAttribute('data-automation-id')}"]`,
            id: fs.id,
            labelText: getLabelText(fs),
            ariaLabel: fs.getAttribute('aria-label') || '',
            sectionHeader: getSectionHeader(fs),
            options: options,
            filled: options.some(o => o.checked),
            required: fs.getAttribute('aria-required') === 'true'
          });
        }
      });

      // ========== FIND DATE PICKERS ==========
      document.querySelectorAll('[data-automation-id*="dateSectionYear-display"], [id*="dateSectionYear-display"]').forEach(el => {
        if (!isVisible(el)) return;
        
        fields.push({
          type: 'datePicker',
          selector: `[id="${el.id}"]`,
          id: el.id,
          labelText: getLabelText(el),
          ariaLabel: el.getAttribute('aria-label') || '',
          sectionHeader: getSectionHeader(el),
          filled: !el.textContent.includes('YYYY'),
          required: false
        });
      });

      return fields;
    });
  }

  // ============================================
  // FILL A CLASSIFIED FIELD
  // ============================================
  async fillClassifiedField(field) {
    const { classification, profileMapping, type, filled } = field;
    
    // Skip if unknown or low confidence
    if (classification.label === 'unknown field') {
      this.skipped++;
      return;
    }
    
    if (classification.confidence < this.confidenceThreshold) {
      console.log(`[SemanticFiller] ⏭️ Skipping "${field.labelText}" - confidence too low (${(classification.confidence * 100).toFixed(1)}%)`);
      this.skipped++;
      return;
    }
    
    // Skip if already filled
    if (filled) {
      this.skipped++;
      return;
    }
    
    // Get value from profile
    const valueInfo = this.classifier.getValueForField(field, this.profile);
    
    if (!valueInfo || valueInfo.value === null || valueInfo.value === undefined || valueInfo.value === '') {
      this.skipped++;
      return;
    }
    
    const label = classification.label.toUpperCase().replace(/ /g, '_');
    
    try {
      let success = false;
      
      switch (type) {
        case 'text':
          success = await this.fillTextInput(field, valueInfo.value, label);
          break;
          
        case 'searchable':
          success = await this.fillSearchableInput(field, valueInfo.searchValue || valueInfo.value, label);
          break;
          
        case 'dropdown':
          success = await this.fillDropdown(field, valueInfo.value, valueInfo.options, label);
          break;
          
        case 'checkbox':
          success = await this.fillCheckbox(field, valueInfo.value, label);
          break;
          
        case 'checkboxGroup':
          success = await this.fillCheckboxGroup(field, valueInfo.value, label);
          break;
          
        case 'radio':
          success = await this.fillRadio(field, valueInfo.value, label);
          break;
          
        case 'datePicker':
          success = await this.fillDatePicker(field, label);
          break;
      }
      
      if (success) this.filled++;
      else this.failed++;
      
    } catch (error) {
      console.log(`[SemanticFiller] ❌ ${label}: ${error.message}`);
      this.failed++;
    }
  }

  // ============================================
  // FILL TEXT INPUT
  // ============================================
  async fillTextInput(field, value, label) {
    const result = await this.page.evaluate(async (selector, id, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      let input = selector ? document.querySelector(selector) : null;
      if (!input && id) input = document.getElementById(id);
      if (!input) return { success: false, error: 'Input not found' };

      if (input.value === val) return { success: true, skipped: true };

      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      for (const char of val) {
        input.value += char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(100);
      
      return { success: true };
    }, field.selector, field.id, String(value));

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${value}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL SEARCHABLE INPUT (Type to search dropdown)
  // ============================================
  async fillSearchableInput(field, value, label) {
    const result = await this.page.evaluate(async (selector, id, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      let input = selector ? document.querySelector(selector) : null;
      if (!input && id) input = document.getElementById(id);
      if (!input) return { success: false, error: 'Searchable input not found' };

      // Check if already has a value
      const container = input.closest('[data-uxi-widget-type]')?.parentElement || input.parentElement;
      const pill = container?.querySelector('[data-automation-id="selectedItem"]');
      if (pill?.textContent?.trim()) {
        return { success: true, selected: pill.textContent.trim(), skipped: true };
      }

      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);

      for (const char of val) {
        input.value += char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await sleep(800);

      const options = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
      if (!options.length) return { success: false, error: `No suggestions for "${val}"` };

      // Find best match or take first
      let best = null;
      for (const opt of options) {
        const text = opt.textContent?.toLowerCase() || '';
        if (text.includes(val.toLowerCase())) {
          best = opt;
          break;
        }
      }
      if (!best) best = options[0];

      best.click();
      await sleep(300);
      return { success: true, selected: best.textContent?.trim() };
    }, field.selector, field.id, String(value));

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${result.selected || value}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL DROPDOWN
  // ============================================
  async fillDropdown(field, value, options, label) {
    const valuesToTry = options || [value];
    
    const result = await this.page.evaluate(async (selector, id, vals) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      let btn = selector ? document.querySelector(selector) : null;
      if (!btn && id) btn = document.getElementById(id);
      if (!btn) return { success: false, error: 'Dropdown not found' };

      // Check if already selected correctly
      const currentText = btn.textContent.toLowerCase();
      for (const v of vals) {
        if (currentText.includes(v.toLowerCase()) && !currentText.includes('select')) {
          return { success: true, selected: btn.textContent.trim(), skipped: true };
        }
      }

      btn.click();
      await sleep(500);

      const opts = document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
      if (!opts.length) {
        document.body.click();
        return { success: false, error: 'No dropdown options found' };
      }

      // Try each value
      for (const v of vals) {
        const vLower = v.toLowerCase();
        for (const opt of opts) {
          const optText = opt.textContent?.toLowerCase().trim() || '';
          if (optText.includes(vLower) || optText.startsWith(vLower.split(' ')[0])) {
            opt.click();
            await sleep(200);
            return { success: true, selected: opt.textContent?.trim() };
          }
        }
      }

      // Try partial match on first word
      for (const v of vals) {
        const firstWord = v.toLowerCase().split(' ')[0];
        for (const opt of opts) {
          const optText = opt.textContent?.toLowerCase().trim() || '';
          if (optText.includes(firstWord)) {
            opt.click();
            await sleep(200);
            return { success: true, selected: opt.textContent?.trim() };
          }
        }
      }

      document.body.click();
      const optList = Array.from(opts).slice(0, 5).map(o => o.textContent?.trim()).join(', ');
      return { success: false, error: `No match for "${vals.join('/')}" in: ${optList}` };
    }, field.selector, field.id, Array.isArray(valuesToTry) ? valuesToTry : [valuesToTry]);

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${result.selected}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL CHECKBOX
  // ============================================
  async fillCheckbox(field, shouldCheck, label) {
    const result = await this.page.evaluate(async (selector, id, check) => {
      let cb = selector ? document.querySelector(selector) : null;
      if (!cb && id) cb = document.getElementById(id);
      if (!cb) return { success: false, error: 'Checkbox not found' };

      const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
      if (isChecked !== check) cb.click();
      return { success: true };
    }, field.selector, field.id, Boolean(shouldCheck));

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: ${shouldCheck ? 'checked' : 'unchecked'}`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL CHECKBOX GROUP
  // ============================================
  async fillCheckboxGroup(field, value, label) {
    const result = await this.page.evaluate(async (selector, id, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      let fieldset = selector ? document.querySelector(selector) : null;
      if (!fieldset && id) fieldset = document.getElementById(id);
      if (!fieldset) return { success: false, error: 'Checkbox group not found' };

      const checkboxes = fieldset.querySelectorAll('input[type="checkbox"]');
      const valLower = String(val).toLowerCase();
      const wantYes = valLower === 'yes' || valLower === 'true';
      const wantNo = valLower === 'no' || valLower === 'false';

      for (const cb of checkboxes) {
        const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
        const lblText = lbl?.textContent?.toLowerCase().trim() || '';

        let shouldCheck = false;

        if (wantYes && lblText === 'yes') shouldCheck = true;
        if (wantNo && lblText === 'no') shouldCheck = true;

        // For longer values, try partial match
        if (!shouldCheck && valLower.length > 5) {
          if (lblText.includes(valLower.substring(0, 15))) shouldCheck = true;
          if (valLower.includes(lblText.substring(0, 15))) shouldCheck = true;
        }

        // Disability-specific
        if (valLower.includes('no') && valLower.includes('disability') && lblText.includes('no, i do not')) shouldCheck = true;
        if (valLower.includes('yes') && valLower.includes('disability') && lblText.includes('yes, i have')) shouldCheck = true;

        if (shouldCheck && !cb.checked) {
          cb.click();
          await sleep(100);
          return { success: true, selected: lbl?.textContent?.trim() };
        }
      }

      return { success: false, error: 'No matching option' };
    }, field.selector, field.id, String(value));

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${result.selected}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL RADIO
  // ============================================
  async fillRadio(field, value, label) {
    const result = await this.page.evaluate(async (name, val) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
      if (!radios.length) return { success: false, error: 'Radio group not found' };

      const valLower = String(val).toLowerCase();
      const wantYes = valLower === 'yes' || valLower === 'true';
      const wantNo = valLower === 'no' || valLower === 'false';

      for (const radio of radios) {
        const lbl = radio.labels?.[0] || document.querySelector(`label[for="${radio.id}"]`);
        const lblText = lbl?.textContent?.toLowerCase().trim() || '';

        if ((wantYes && lblText === 'yes') || (wantNo && lblText === 'no')) {
          radio.click();
          await sleep(100);
          return { success: true, selected: lbl?.textContent?.trim() };
        }

        if ((wantYes && radio.value === 'true') || (wantNo && radio.value === 'false')) {
          radio.click();
          await sleep(100);
          return { success: true, selected: val };
        }
      }

      return { success: false, error: 'No matching radio option' };
    }, field.name, String(value));

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${result.selected}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // FILL DATE PICKER
  // ============================================
  async fillDatePicker(field, label) {
    const result = await this.page.evaluate(async (selector) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');

      const display = document.querySelector(selector);
      if (!display) return { success: false, error: 'Date picker not found' };

      display.click();
      await sleep(300);

      const active = document.activeElement;
      if (active?.tagName === 'INPUT') {
        active.value = String(y);
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        active.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      return { success: true, date: `${m}/${d}/${y}` };
    }, field.selector);

    if (result.success) console.log(`[SemanticFiller] ✅ ${label}: "${result.date}"`);
    else console.log(`[SemanticFiller] ❌ ${label}: ${result.error}`);
    return result.success;
  }

  // ============================================
  // RESUME UPLOAD
  // ============================================
  async uploadResume() {
    const path = this.profile.documents?.resumePath;
    if (!path) {
      console.log('[SemanticFiller] ⏭️ Resume: No path configured');
      return;
    }

    try {
      const btn = await this.page.$('[data-automation-id="select-files"]');
      if (btn) {
        const [chooser] = await Promise.all([
          this.page.waitForFileChooser({ timeout: 5000 }),
          btn.click()
        ]);
        await chooser.accept([path]);
        console.log('[SemanticFiller] ✅ Resume: Uploaded');
        this.filled++;
        return;
      }

      const input = await this.page.$('input[type="file"]');
      if (input) {
        await input.uploadFile(path);
        console.log('[SemanticFiller] ✅ Resume: Uploaded');
        this.filled++;
        return;
      }

      console.log('[SemanticFiller] ⏭️ Resume: No file input found');
    } catch (e) {
      console.log(`[SemanticFiller] ⏭️ Resume: ${e.message}`);
    }
  }
}

export default SemanticFormFiller;
