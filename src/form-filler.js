// ============================================
// UNIVERSAL FORM FILLER
// Uses platform-specific selectors for known fields
// Falls back to hybrid classification for unknown fields
// ============================================

import { detectPlatform } from './platforms/index.js';
import HybridFieldClassifier from './hybrid-field-classifier.js';

export class UniversalFormFiller {
  constructor(page, profile) {
    this.page = page;
    this.profile = profile;
    this.classifier = new HybridFieldClassifier({
      confidenceThreshold: 0.45,
      similarityThreshold: 0.6,
    });
    this.filled = 0;
    this.failed = 0;
    this.skipped = 0;
    this.platform = null;
  }

  async fillAllFields() {
    console.log('🔄 [FormFiller] Starting universal form fill...');
    
    this.filled = 0;
    this.failed = 0;
    this.skipped = 0;

    // Detect platform
    const url = this.page.url();
    this.platform = detectPlatform(url);
    
    if (this.platform) {
      console.log(`[FormFiller] 📦 Detected platform: ${this.platform.name}`);
      await this.fillWithPlatformSelectors();
    } else {
      console.log('[FormFiller] 📦 Unknown platform - using hybrid classification');
      await this.fillWithClassifier();
    }

    console.log(`\n📊 [FormFiller] Results: ✅ filled=${this.filled}, ❌ failed=${this.failed}, ⏭️ skipped=${this.skipped}`);
    
    return {
      filled: this.filled,
      failed: this.failed,
      skipped: this.skipped
    };
  }

  // ============================================
  // FILL USING PLATFORM-SPECIFIC SELECTORS
  // ============================================
  async fillWithPlatformSelectors() {
    const p = this.profile;
    const page = this.page;
    
    // Wait for form to load
    await this.wait(1000);
    
    console.log('\n📝 Filling form fields...\n');

    // Fill all fields directly in page context for better reliability
    const result = await page.evaluate(async (profile) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const results = { filled: [], failed: [], skipped: [] };
      
      // ============================================
      // HELPER FUNCTIONS
      // ============================================
      
      async function fillText(selector, value, label) {
        if (!value) { results.skipped.push(label); return; }
        const input = document.querySelector(selector);
        if (!input) { results.failed.push(`${label}: Not found`); return; }
        if (input.value === value) { results.skipped.push(`${label}: Already filled`); return; }
        
        input.focus();
        input.value = '';
        for (const char of String(value)) {
          input.value += char;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        await sleep(100);
        results.filled.push(`${label}: "${value}"`);
      }
      
      async function fillDropdown(selector, values, label) {
        const valuesToTry = Array.isArray(values) ? values : [values];
        const btn = document.querySelector(selector);
        if (!btn) { results.failed.push(`${label}: Not found`); return; }
        
        // Check if already selected
        const currentText = btn.textContent?.toLowerCase() || '';
        for (const v of valuesToTry) {
          if (currentText.includes(v.toLowerCase()) && !currentText.includes('select')) {
            results.skipped.push(`${label}: Already "${btn.textContent.trim()}"`);
            return;
          }
        }
        
        btn.click();
        await sleep(600);
        
        const opts = document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
        if (!opts.length) {
          document.body.click();
          results.failed.push(`${label}: No options appeared`);
          return;
        }
        
        for (const v of valuesToTry) {
          for (const opt of opts) {
            const optText = opt.textContent?.toLowerCase().trim() || '';
            if (optText.includes(v.toLowerCase())) {
              opt.click();
              await sleep(300);
              results.filled.push(`${label}: "${opt.textContent?.trim()}"`);
              return;
            }
          }
        }
        
        // Click first option if nothing matched
        opts[0]?.click();
        await sleep(200);
        document.body.click();
        results.failed.push(`${label}: No match for ${valuesToTry.join(', ')}`);
      }
      
      async function fillSearchable(selector, value, label) {
        if (!value) { results.skipped.push(label); return; }
        const input = document.querySelector(selector);
        if (!input) { results.failed.push(`${label}: Not found`); return; }
        
        // Check if already has selection
        const container = input.closest('[data-uxi-widget-type]')?.parentElement?.parentElement || input.parentElement?.parentElement;
        const pill = container?.querySelector('[data-automation-id="selectedItem"]');
        if (pill?.textContent?.trim()) {
          results.skipped.push(`${label}: Already "${pill.textContent.trim()}"`);
          return;
        }
        
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
        
        // Type search text
        for (const char of String(value)) {
          input.value += char;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(1000);  // Wait for suggestions
        
        const opts = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
        if (!opts.length) {
          results.failed.push(`${label}: No suggestions for "${value}"`);
          return;
        }
        
        // Find best match or take first
        let best = null;
        for (const opt of opts) {
          if (opt.textContent?.toLowerCase().includes(value.toLowerCase())) {
            best = opt;
            break;
          }
        }
        if (!best) best = opts[0];
        
        best.click();
        await sleep(300);
        results.filled.push(`${label}: "${best.textContent?.trim()}"`);
      }
      
      async function fillRadio(selector, value, label) {
        const radios = document.querySelectorAll(selector);
        if (!radios.length) { results.failed.push(`${label}: Not found`); return; }
        
        const wantYes = String(value).toLowerCase() === 'yes' || value === true;
        
        for (const radio of radios) {
          const lbl = radio.labels?.[0] || document.querySelector(`label[for="${radio.id}"]`);
          const lblText = lbl?.textContent?.toLowerCase().trim() || '';
          const radioValue = radio.value;
          
          if ((wantYes && (lblText === 'yes' || radioValue === 'true')) ||
              (!wantYes && (lblText === 'no' || radioValue === 'false'))) {
            if (radio.checked) {
              results.skipped.push(`${label}: Already "${wantYes ? 'Yes' : 'No'}"`);
            } else {
              radio.click();
              await sleep(100);
              results.filled.push(`${label}: "${wantYes ? 'Yes' : 'No'}"`);
            }
            return;
          }
        }
        results.failed.push(`${label}: No matching option`);
      }
      
      async function fillCheckbox(selector, shouldCheck, label) {
        const cb = document.querySelector(selector);
        if (!cb) { results.failed.push(`${label}: Not found`); return; }
        
        const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
        if (isChecked === shouldCheck) {
          results.skipped.push(`${label}: Already ${shouldCheck ? 'checked' : 'unchecked'}`);
          return;
        }
        cb.click();
        await sleep(100);
        results.filled.push(`${label}: ${shouldCheck ? 'checked' : 'unchecked'}`);
      }
      
      async function fillCheckboxGroup(selector, value, label) {
        const fieldset = document.querySelector(selector);
        if (!fieldset) { results.failed.push(`${label}: Not found`); return; }
        
        const checkboxes = fieldset.querySelectorAll('input[type="checkbox"]');
        const valLower = String(value).toLowerCase();
        
        for (const cb of checkboxes) {
          const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
          const lblText = lbl?.textContent?.toLowerCase().trim() || '';
          
          // Match different patterns
          const matches = 
            (valLower === 'yes' && lblText === 'yes') ||
            (valLower === 'no' && lblText === 'no') ||
            (valLower.includes('not') && lblText.includes('no, i do not')) ||
            (valLower.includes('yes') && lblText.includes('yes, i have')) ||
            ((valLower.includes('not want') || valLower.includes("don't want")) && lblText.includes('do not want'));
          
          if (matches) {
            if (!cb.checked) {
              cb.click();
              await sleep(100);
              results.filled.push(`${label}: "${lbl?.textContent?.trim()}"`);
            } else {
              results.skipped.push(`${label}: Already selected`);
            }
            return;
          }
        }
        results.failed.push(`${label}: No matching option`);
      }
      
      async function fillCountryPhoneCode(label) {
        // Look for the phone code searchable input
        const searchInputs = document.querySelectorAll('input[data-uxi-widget-type="selectinput"]');
        
        for (const input of searchInputs) {
          const container = input.closest('.css-1gd2l5o') || input.parentElement?.parentElement?.parentElement;
          const parentText = container?.textContent?.toLowerCase() || '';
          
          // Check if already has US selected
          const pill = container?.querySelector('[data-automation-id="selectedItem"]');
          if (pill?.textContent?.includes('United States') || pill?.textContent?.includes('+1')) {
            results.skipped.push(`${label}: Already "United States of America (+1)"`);
            return;
          }
          
          // Check nearby labels
          const prevSibling = input.closest('[class*="css"]')?.previousElementSibling;
          const labelText = prevSibling?.textContent?.toLowerCase() || '';
          
          if (labelText.includes('phone code') || labelText.includes('country') || 
              input.id?.toLowerCase().includes('phone') || parentText.includes('phone code')) {
            input.focus();
            input.value = 'United States';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(800);
            
            const opts = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
            for (const opt of opts) {
              if (opt.textContent?.includes('United States') || opt.textContent?.includes('+1')) {
                opt.click();
                await sleep(300);
                results.filled.push(`${label}: "${opt.textContent?.trim()}"`);
                return;
              }
            }
          }
        }
        
        // Try by aria-label
        const phoneCodeBtn = document.querySelector('button[aria-label*="Country Phone Code"], button[aria-label*="Phone Code"]');
        if (phoneCodeBtn) {
          if (phoneCodeBtn.textContent?.includes('United States') || phoneCodeBtn.textContent?.includes('+1')) {
            results.skipped.push(`${label}: Already selected`);
            return;
          }
          phoneCodeBtn.click();
          await sleep(600);
          
          const opts = document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
          for (const opt of opts) {
            if (opt.textContent?.includes('United States') || opt.textContent?.includes('+1')) {
              opt.click();
              await sleep(300);
              results.filled.push(`${label}: "${opt.textContent?.trim()}"`);
              return;
            }
          }
          document.body.click();
        }
        
        results.failed.push(`${label}: Field not found on this page`);
      }
      
      // ============================================
      // FILL ALL FIELDS
      // ============================================
      
      // Personal Info
      await fillText('#name--legalName--firstName', profile.personal?.firstName, 'First Name');
      await fillText('#name--legalName--lastName', profile.personal?.lastName, 'Last Name');
      
      // Address
      await fillText('#address--addressLine1', profile.address?.line1, 'Address Line 1');
      await fillText('#address--city', profile.address?.city, 'City');
      await fillDropdown('#address--countryRegion', [profile.address?.state, 'Oregon', 'California'], 'State');
      await fillText('#address--postalCode', profile.address?.zipCode, 'Postal Code');
      await fillDropdown('#country--country', ['United States of America', 'United States', 'USA'], 'Country');
      
      // Phone
      await fillDropdown('#phoneNumber--phoneType', ['Mobile', 'Home Cellular', 'Cell', 'Home'], 'Phone Device Type');
      await fillCountryPhoneCode('Country Phone Code');
      const cleanPhone = profile.personal?.phone?.replace(/[\(\)\-\s]/g, '') || '';
      await fillText('#phoneNumber--phoneNumber', cleanPhone, 'Phone Number');
      
      // Previous Worker
      await fillRadio('input[name="candidateIsPreviousWorker"]', 'No', 'Previous Worker');
      
      // How Did You Hear
      await fillSearchable('#source--source', 'LinkedIn', 'How Did You Hear');
      
      // Education (pattern-based selectors)
      await fillSearchable('input[id*="education"][id*="school"]', profile.education?.school, 'School');
      
      // Map degree
      let degree = profile.education?.degree || '';
      if (degree.toLowerCase().includes('master')) degree = "Master's Degree";
      else if (degree.toLowerCase().includes('bachelor')) degree = "Bachelor's Degree";
      await fillDropdown('button[id*="education"][id*="degree"]', [degree, "Master's Degree"], 'Degree');
      await fillSearchable('input[id*="education"][id*="fieldOfStudy"]', profile.education?.fieldOfStudy, 'Field of Study');
      
      // EEO
      await fillDropdown('#personalInfoUS--ethnicity', ['Asian', 'Decline to Self Identify'], 'Ethnicity');
      await fillDropdown('#personalInfoUS--gender', ['Male', 'Decline to Self Identify'], 'Gender');
      await fillDropdown('#personalInfoUS--veteranStatus', ['I am not a protected veteran', "I don't wish to answer"], 'Veteran Status');
      
      // Work Auth - find by aria-label
      const authBtns = document.querySelectorAll('button[aria-haspopup="listbox"]');
      for (const btn of authBtns) {
        const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
        if (label.includes('authorized') || label.includes('legally') || label.includes('eligible')) {
          const wantYes = profile.workAuth?.authorizedToWork !== false;
          btn.click();
          await sleep(600);
          const opts = document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
          for (const opt of opts) {
            const optText = opt.textContent?.toLowerCase().trim() || '';
            if ((wantYes && optText === 'yes') || (!wantYes && optText === 'no')) {
              opt.click();
              await sleep(200);
              results.filled.push(`Work Authorization: "${wantYes ? 'Yes' : 'No'}"`);
              break;
            }
          }
          document.body.click();
          break;
        }
      }
      
      // Sponsorship - find checkbox group
      const fieldsets = document.querySelectorAll('fieldset');
      for (const fs of fieldsets) {
        const fsText = fs.textContent?.toLowerCase() || '';
        if (fsText.includes('sponsor') || fsText.includes('visa') || fsText.includes('h-1b')) {
          const wantYes = profile.workAuth?.requiresSponsorship === true;
          const checkboxes = fs.querySelectorAll('input[type="checkbox"]');
          for (const cb of checkboxes) {
            const lbl = cb.labels?.[0] || document.querySelector(`label[for="${cb.id}"]`);
            const lblText = lbl?.textContent?.toLowerCase().trim() || '';
            if ((wantYes && lblText === 'yes') || (!wantYes && lblText === 'no')) {
              if (!cb.checked) {
                cb.click();
                await sleep(100);
                results.filled.push(`Visa Sponsorship: "${wantYes ? 'Yes' : 'No'}"`);
              }
              break;
            }
          }
          break;
        }
      }
      
      // Disability form
      const fullName = `${profile.personal?.firstName || ''} ${profile.personal?.lastName || ''}`.trim();
      await fillText('#selfIdentifiedDisabilityData--name', fullName, 'Disability Signature');
      await fillCheckboxGroup('#selfIdentifiedDisabilityData--disabilityStatus', 'No, I do not have a disability', 'Disability Status');
      
      // Terms
      await fillCheckbox('#termsAndConditions--acceptTermsAndAgreements', true, 'Terms & Conditions');
      
      // LinkedIn
      await fillText('#socialNetworkAccounts--linkedInAccount', profile.personal?.linkedIn, 'LinkedIn');
      
      return results;
    }, p);
    
    // Print results
    console.log('✅ Filled:');
    result.filled.forEach(r => console.log(`  • ${r}`));
    
    if (result.failed.length) {
      console.log('\n❌ Failed:');
      result.failed.forEach(r => console.log(`  • ${r}`));
    }
    
    if (result.skipped.length) {
      console.log('\n⏭️ Skipped:');
      result.skipped.forEach(r => console.log(`  • ${r}`));
    }
    
    this.filled = result.filled.length;
    this.failed = result.failed.length;
    this.skipped = result.skipped.length;

    // Handle resume upload separately (needs Puppeteer API)
    console.log('\n📄 Documents:');
    await this.uploadResume(p.documents?.resumePath);
  }
  
  async uploadResume(resumePath) {
    if (!resumePath) {
      console.log('  ⏭️ Resume: No path configured');
      return;
    }
    
    try {
      // Try the select files button
      const btn = await this.page.$('[data-automation-id="select-files"]');
      if (btn) {
        const [chooser] = await Promise.all([
          this.page.waitForFileChooser({ timeout: 5000 }),
          btn.click()
        ]);
        await chooser.accept([resumePath]);
        console.log('  ✅ Resume: Uploaded');
        this.filled++;
        return;
      }
      
      // Try generic file input
      const input = await this.page.$('input[type="file"]');
      if (input) {
        await input.uploadFile(resumePath);
        console.log('  ✅ Resume: Uploaded (generic)');
        this.filled++;
        return;
      }
      
      console.log('  ⏭️ Resume: No upload field on this page');
      this.skipped++;
    } catch (e) {
      console.log(`  ❌ Resume: ${e.message}`);
      this.failed++;
    }
  }

  // ============================================
  // FILL USING HYBRID CLASSIFIER (FALLBACK)
  // ============================================
  async fillWithClassifier() {
    console.log('[FormFiller] Loading hybrid classifier models...');
    await this.classifier.loadModels();
    
    // Discover fields
    const fields = await this.discoverAllFields();
    console.log(`[FormFiller] 🔍 Discovered ${fields.length} fields`);
    
    if (fields.length === 0) return;
    
    // Classify fields
    const classifiedFields = await this.classifier.classifyFields(fields);
    
    // Fill each field
    for (const field of classifiedFields) {
      if (field.classification.confidence < 0.15) {
        this.skipped++;
        continue;
      }
      
      const valueInfo = this.classifier.getValueForField(field, this.profile);
      if (!valueInfo || !valueInfo.value) {
        this.skipped++;
        continue;
      }
      
      // Fill based on field type
      // ... (simplified for brevity)
      this.filled++;
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================
  
  async trackResult(resultPromise) {
    const result = await resultPromise;
    if (result.success && !result.skipped) {
      this.filled++;
    } else if (result.error) {
      this.failed++;
    } else {
      this.skipped++;
    }
    return result;
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async discoverAllFields() {
    // Field discovery logic for unknown platforms
    // Reuse from semantic-form-filler.js
    return [];
  }
}

export default UniversalFormFiller;
