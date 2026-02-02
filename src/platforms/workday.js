// ============================================
// WORKDAY PLATFORM - PUPPETEER VERSION
// Uses Puppeteer methods (not Playwright)
// ============================================

// Helper function for delays (Puppeteer doesn't have waitForTimeout)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const WorkdayPlatform = {
  name: 'workday',
  
  // URL patterns to detect Workday
  urlPatterns: [
    /myworkday(jobs)?\.com/i,
    /wd\d+\.myworkday/i
  ],

  // ============================================
  // STATIC SELECTORS - Known stable IDs
  // ============================================
  selectors: {
    // Personal Information
    firstName: '#name--legalName--firstName',
    lastName: '#name--legalName--lastName',
    
    // Address
    addressLine1: '#address--addressLine1',
    city: '#address--city',
    postalCode: '#address--postalCode',
    state: '#address--countryRegion',
    country: '#country--country',
    
    // Phone
    phoneNumber: '#phoneNumber--phoneNumber',
    phoneExtension: '#phoneNumber--extension',
    phoneType: '#phoneNumber--phoneType',
    
    // Previous Worker (Radio)
    previousWorker: 'input[name="candidateIsPreviousWorker"]',
    
    // How Did You Hear About Us (Searchable)
    source: '#source--source',
    
    // Education
    schoolPattern: 'input[id*="education"][id*="school"]',
    degreePattern: 'button[id*="education"][id*="degree"]',
    fieldOfStudyPattern: 'input[id*="education"][id*="fieldOfStudy"]',
    
    // EEO / Voluntary Self-Identification
    ethnicity: '#personalInfoUS--ethnicity',
    gender: '#personalInfoUS--gender',
    veteranStatus: '#personalInfoUS--veteranStatus',
    
    // Disability Form
    disabilityName: '#selfIdentifiedDisabilityData--name',
    disabilityStatus: '#selfIdentifiedDisabilityData--disabilityStatus',
    
    // Terms and Conditions
    termsCheckbox: '#termsAndConditions--acceptTermsAndAgreements',
    
    // Resume Upload
    resumeButton: '[data-automation-id="select-files"]',
  },

  // ============================================
  // NATIVE PLAYWRIGHT FILL METHODS
  // These bypass CSP by using browser-level automation
  // ============================================
  
  /**
   * Fill a text input using native Puppeteer
   * WITH COMPREHENSIVE DEBUGGING to find universal patterns
   */
  async fillTextInput(page, selector, value, label) {
    if (!value) return { success: false, skipped: true };
    
    console.log(`\n  ┌─── DEBUG: fillTextInput("${label}") ───`);
    console.log(`  │ Selector: ${selector}`);
    console.log(`  │ Value to fill: "${value}"`);
    
    try {
      // STEP 1: Find the element
      const element = await page.$(selector);
      if (!element) {
        console.log(`  │ ❌ Element NOT FOUND with selector`);
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: 'Not found' };
      }
      console.log(`  │ ✓ Element found`);
      
      // STEP 2: Get element details BEFORE interaction
      const beforeInfo = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        return {
          tagName: el.tagName,
          type: el.type || 'N/A',
          id: el.id,
          name: el.name,
          className: (el.className || '').substring?.(0, 60) || '',
          value: el.value || '',
          innerText: (el.innerText || '').substring?.(0, 30) || '',
          textContent: (el.textContent || '').substring?.(0, 30) || '',
          isVisible: rect.width > 0 && rect.height > 0,
          isDisabled: el.disabled,
          isReadOnly: el.readOnly,
          contentEditable: el.contentEditable,
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          dataAutomationId: el.getAttribute('data-automation-id'),
          display: styles.display,
          visibility: styles.visibility,
          position: { width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      });
      
      console.log(`  │`);
      console.log(`  │ ELEMENT ANALYSIS (BEFORE):`);
      console.log(`  │   Tag: <${beforeInfo.tagName.toLowerCase()}>`);
      console.log(`  │   type="${beforeInfo.type}" | id="${beforeInfo.id || '(none)'}"`);
      console.log(`  │   data-automation-id: ${beforeInfo.dataAutomationId || '(none)'}`);
      console.log(`  │   role: ${beforeInfo.role || '(none)'}`);
      console.log(`  │   contentEditable: ${beforeInfo.contentEditable}`);
      console.log(`  │   Size: ${beforeInfo.position.width}x${beforeInfo.position.height}px`);
      console.log(`  │   Visible: ${beforeInfo.isVisible} | display: ${beforeInfo.display}`);
      console.log(`  │   Disabled: ${beforeInfo.isDisabled} | ReadOnly: ${beforeInfo.isReadOnly}`);
      console.log(`  │   Current .value: "${beforeInfo.value}"`);
      console.log(`  │   Current .innerText: "${beforeInfo.innerText}"`);
      
      // Check if already filled
      if (beforeInfo.value === String(value)) {
        console.log(`  │`);
        console.log(`  │ ⏭️ Already has correct value - skipping`);
        console.log(`  └─── END DEBUG ───\n`);
        return { success: true, skipped: true };
      }
      
      // STEP 3: Look for what element is ACTUALLY editable in this container
      console.log(`  │`);
      console.log(`  │ SEARCHING FOR EDITABLE ELEMENTS IN CONTAINER:`);
      
      const editableSearch = await element.evaluate(el => {
        // Go up to find container
        const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement;
        if (!container) return { containerFound: false };
        
        // Find all potentially editable elements
        const results = [];
        
        // Check the element itself
        results.push({
          source: 'SELF',
          tag: el.tagName,
          type: el.type || '',
          id: el.id,
          editable: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true',
          value: el.value || el.textContent?.substring(0, 20) || ''
        });
        
        // Check for input children
        const inputs = container.querySelectorAll('input:not([type="hidden"]), textarea');
        inputs.forEach((inp, i) => {
          if (inp !== el) {
            results.push({
              source: `INPUT[${i}]`,
              tag: inp.tagName,
              type: inp.type || '',
              id: inp.id,
              editable: !inp.disabled && !inp.readOnly,
              value: inp.value || ''
            });
          }
        });
        
        // Check for contenteditable
        const editables = container.querySelectorAll('[contenteditable="true"]');
        editables.forEach((ed, i) => {
          if (ed !== el) {
            results.push({
              source: `CONTENTEDITABLE[${i}]`,
              tag: ed.tagName,
              type: 'contenteditable',
              id: ed.id,
              editable: true,
              value: ed.textContent?.substring(0, 20) || ''
            });
          }
        });
        
        // Check for hidden inputs (where Workday might store actual value)
        const hiddens = container.querySelectorAll('input[type="hidden"]');
        hiddens.forEach((h, i) => {
          results.push({
            source: `HIDDEN[${i}]`,
            tag: 'INPUT',
            type: 'hidden',
            id: h.id,
            name: h.name,
            editable: false,
            value: h.value || ''
          });
        });
        
        return {
          containerFound: true,
          containerId: container.getAttribute('data-automation-id'),
          elements: results
        };
      });
      
      if (editableSearch.containerFound) {
        console.log(`  │   Container: ${editableSearch.containerId || '(no automation-id)'}`);
        for (const elem of editableSearch.elements) {
          const marker = elem.editable ? '→' : ' ';
          console.log(`  │   ${marker} ${elem.source}: <${elem.tag.toLowerCase()} type="${elem.type}"> id="${elem.id || ''}" value="${elem.value}"`);
        }
      }
      
      // STEP 4: Scroll into view and focus properly
      console.log(`  │`);
      console.log(`  │ ACTION: Scrolling into view...`);
      await element.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await sleep(100);
      
      console.log(`  │ ACTION: Click to focus...`);
      await element.click();
      await sleep(100);
      
      // Check what's focused now
      const focusInfo = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName,
          id: el?.id,
          type: el?.type,
          contentEditable: el?.contentEditable,
          dataAutomationId: el?.getAttribute?.('data-automation-id')
        };
      });
      console.log(`  │   → Focused: <${focusInfo.tag?.toLowerCase()}> id="${focusInfo.id || ''}" type="${focusInfo.type || ''}" contentEditable="${focusInfo.contentEditable}"`);
      
      // If focus went to wrong element, try explicit focus
      if (focusInfo.id !== beforeInfo.id) {
        console.log(`  │   ⚠️ Focus went to wrong element! Trying explicit focus...`);
        await element.evaluate(el => el.focus());
        await sleep(100);
        
        const focusRetry = await page.evaluate(() => {
          const el = document.activeElement;
          return { tag: el?.tagName, id: el?.id };
        });
        console.log(`  │   → After focus(): <${focusRetry.tag?.toLowerCase()}> id="${focusRetry.id || ''}"`);
        
        // If still wrong, click inside the element explicitly
        if (focusRetry.id !== beforeInfo.id) {
          console.log(`  │   ⚠️ Still wrong! Trying click at element center...`);
          const box = await element.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await sleep(100);
          }
        }
      }
      
      // STEP 5: Select all with Ctrl+A
      console.log(`  │ ACTION: Ctrl+A to select all...`);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await sleep(50);
      
      // STEP 6: Type the value
      console.log(`  │ ACTION: Typing "${value}"...`);
      await page.keyboard.type(String(value));
      await sleep(100);
      
      // STEP 7: Check state AFTER typing (before Tab)
      const afterTypeInfo = await element.evaluate(el => {
        const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement;
        const hiddens = container?.querySelectorAll('input[type="hidden"]') || [];
        const hiddenValues = Array.from(hiddens).map(h => ({ id: h.id, value: h.value }));
        
        return {
          elementValue: el.value || '',
          elementInnerText: (el.innerText || '').substring(0, 30),
          elementTextContent: (el.textContent || '').substring(0, 30),
          hiddenInputs: hiddenValues
        };
      });
      
      console.log(`  │`);
      console.log(`  │ STATE AFTER TYPING (before Tab):`);
      console.log(`  │   element.value: "${afterTypeInfo.elementValue}"`);
      console.log(`  │   element.innerText: "${afterTypeInfo.elementInnerText}"`);
      console.log(`  │   element.textContent: "${afterTypeInfo.elementTextContent}"`);
      if (afterTypeInfo.hiddenInputs.length > 0) {
        console.log(`  │   Hidden inputs:`);
        for (const h of afterTypeInfo.hiddenInputs) {
          console.log(`  │     - ${h.id}: "${h.value}"`);
        }
      }
      
      // STEP 8: Press Tab to trigger blur/validation
      console.log(`  │ ACTION: Tab to blur/validate...`);
      await page.keyboard.press('Tab');
      await sleep(200);
      
      // STEP 9: Final state check
      const finalInfo = await element.evaluate(el => {
        const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement;
        const hiddens = container?.querySelectorAll('input[type="hidden"]') || [];
        const hiddenValues = Array.from(hiddens).map(h => ({ id: h.id, value: h.value }));
        
        // Check for validation errors
        const errorEl = container?.querySelector('[data-automation-id*="error"], .error, [class*="invalid"]');
        
        return {
          elementValue: el.value || '',
          elementInnerText: (el.innerText || '').substring(0, 30),
          elementTextContent: (el.textContent || '').substring(0, 30),
          hiddenInputs: hiddenValues,
          hasError: !!errorEl,
          errorText: errorEl?.textContent?.substring(0, 50) || ''
        };
      });
      
      console.log(`  │`);
      console.log(`  │ FINAL STATE (after Tab):`);
      console.log(`  │   element.value: "${finalInfo.elementValue}"`);
      console.log(`  │   element.innerText: "${finalInfo.elementInnerText}"`);
      console.log(`  │   element.textContent: "${finalInfo.elementTextContent}"`);
      if (finalInfo.hiddenInputs.length > 0) {
        console.log(`  │   Hidden inputs:`);
        for (const h of finalInfo.hiddenInputs) {
          console.log(`  │     - ${h.id}: "${h.value}"`);
        }
      }
      if (finalInfo.hasError) {
        console.log(`  │   ⚠️ VALIDATION ERROR: "${finalInfo.errorText}"`);
      }
      
      // DETERMINE SUCCESS
      const valueStr = String(value);
      const success = finalInfo.elementValue === valueStr || 
                      finalInfo.elementInnerText.includes(valueStr.substring(0, 10)) ||
                      finalInfo.elementTextContent.includes(valueStr.substring(0, 10)) ||
                      finalInfo.hiddenInputs.some(h => h.value === valueStr);
      
      console.log(`  │`);
      if (success) {
        console.log(`  │ ✅ SUCCESS - Value appears to be stored`);
      } else {
        console.log(`  │ ❌ FAILED - Value NOT stored correctly`);
        console.log(`  │   Expected: "${value}"`);
        console.log(`  │   Found in .value: "${finalInfo.elementValue}"`);
        console.log(`  │   Found in text: "${finalInfo.elementTextContent}"`);
      }
      console.log(`  └─── END DEBUG ───\n`);
      
      if (success) {
        console.log(`  ✅ ${label}: "${value}"`);
      }
      return { success };
      
    } catch (e) {
      console.log(`  │ ❌ ERROR: ${e.message}`);
      console.log(`  └─── END DEBUG ───\n`);
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill a dropdown by clicking and selecting option
   * Uses native click() and keyboard navigation
   */
  async fillDropdown(page, selector, values, label, classifier = null) {
    const valuesToTry = Array.isArray(values) ? values : [values];
    
    try {
      const btn = await page.$(selector);
      if (!btn) {
        console.log(`  ❌ ${label}: Not found`);
        return { success: false, error: 'Not found' };
      }
      
      // Check if already has a value (not "Select One") - Puppeteer compatible
      const btnText = await btn.evaluate(el => el.textContent || '');
      const isAlreadyFilled = btnText && !btnText.toLowerCase().includes('select');
      
      for (const v of valuesToTry) {
        if (isAlreadyFilled && btnText.toLowerCase().includes(v.toLowerCase())) {
          console.log(`  ⏭️ ${label}: Already "${btnText.trim()}"`);
          return { success: true, selected: btnText.trim(), skipped: true };
        }
      }
      
      // Check if this is a State/Province field
      const labelLower = label.toLowerCase();
      const isStateField = labelLower.includes('state') || labelLower.includes('province') || labelLower.includes('region');
      
      // Click to open dropdown
      await btn.click();
      await sleep(500);
      
      // Try to find and click matching option - Puppeteer compatible
      for (const v of valuesToTry) {
        // Use XPath for text matching (Puppeteer compatible)
        const xpathSelectors = [
          `//div[@data-automation-id="promptOption"][contains(text(), "${v}")]`,
          `//*[@role="option"][contains(text(), "${v}")]`,
          `//li[contains(text(), "${v}")]`,
        ];
        
        for (const xpath of xpathSelectors) {
          try {
            const opts = await page.$x(xpath);
            if (opts.length > 0) {
              await opts[0].click();
              await sleep(200);
              console.log(`  ✅ ${label}: "${v}"`);
              return { success: true, selected: v };
            }
          } catch (e) {
            // Try next selector
          }
        }
        
        // Also try getting all options and searching by text
        const allOptions = await page.$$('[data-automation-id="promptOption"], [role="option"]');
        for (const opt of allOptions) {
          const optText = await opt.evaluate(el => el.textContent || '');
          if (optText.toLowerCase().includes(v.toLowerCase())) {
            await opt.click();
            await sleep(200);
            console.log(`  ✅ ${label}: "${v}"`);
            return { success: true, selected: v };
          }
        }
      }
      
      // STATE FIELD: Use keyboard type-ahead if direct selection failed
      if (isStateField) {
        console.log(`  🔍 ${label}: Using type-ahead for state selection...`);
        // Type the state name to filter the dropdown
        await page.keyboard.type(valuesToTry[0], { delay: 30 });
        await sleep(400);
        // Press ArrowDown then Enter to select
        await page.keyboard.press('ArrowDown');
        await sleep(100);
        await page.keyboard.press('Enter');
        await sleep(300);
        
        // Check if it worked - Puppeteer compatible
        const newBtnText = await btn.evaluate(el => el.textContent || '').catch(() => '');
        if (newBtnText && !newBtnText.toLowerCase().includes('select')) {
          console.log(`  ✅ ${label}: "${newBtnText.trim()}"`);
          return { success: true, selected: newBtnText.trim() };
        }
      }
      
      // Fallback: Use keyboard to navigate and select first option
      await page.keyboard.press('ArrowDown');
      await sleep(100);
      await page.keyboard.press('Enter');
      await sleep(200);
      
      // Close any remaining popup
      await page.keyboard.press('Escape');
      
      console.log(`  ✅ ${label}: (first option)`);
      return { success: true, selected: '(first option)' };
      
    } catch (e) {
      // Try to close popup on error
      await page.keyboard.press('Escape').catch(() => {});
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill a searchable/autocomplete field
   * Types to search, then selects from results
   */
  async fillSearchable(page, selector, value, label, classifier = null) {
    if (!value) return { success: false, skipped: true };
    
    console.log(`\n  ┌─── DEBUG: fillSearchable("${label}") ───`);
    console.log(`  │ Selector: ${selector}`);
    console.log(`  │ Value to search: "${value}"`);
    
    try {
      const input = await page.$(selector);
      if (!input) {
        console.log(`  │ ❌ Element NOT FOUND`);
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: 'Not found' };
      }
      console.log(`  │ ✓ Element found`);
      
      // Get element info
      const inputInfo = await input.evaluate(el => ({
        tag: el.tagName,
        type: el.type,
        id: el.id,
        role: el.getAttribute('role'),
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaAutocomplete: el.getAttribute('aria-autocomplete'),
        dataAutomationId: el.getAttribute('data-automation-id'),
        value: el.value || ''
      }));
      
      console.log(`  │ Element: <${inputInfo.tag.toLowerCase()} type="${inputInfo.type}">`);
      console.log(`  │   id: ${inputInfo.id}`);
      console.log(`  │   data-automation-id: ${inputInfo.dataAutomationId}`);
      console.log(`  │   aria-autocomplete: ${inputInfo.ariaAutocomplete}`);
      console.log(`  │   aria-expanded: ${inputInfo.ariaExpanded}`);
      console.log(`  │   current value: "${inputInfo.value}"`);
      
      // Check if already has a selected value (look for pill IN THIS FIELD'S CONTAINER)
      console.log(`  │`);
      console.log(`  │ Checking for existing selection (pill) in this field's container...`);
      
      const existingPill = await input.evaluate(el => {
        // Find the container for this specific field
        const container = el.closest('[data-automation-id*="formField"]') || 
                          el.closest('[data-automation-id*="source"]') ||
                          el.parentElement?.parentElement?.parentElement;
        
        if (!container) return { found: false, noContainer: true };
        
        // Look for pill ONLY within this container
        const pillSelectors = [
          '[data-automation-id="selectedItem"]',
          '[data-automation-id="multiSelectItem"]',
          '[class*="selectedItem"]'
        ];
        
        for (const sel of pillSelectors) {
          const pill = container.querySelector(sel);
          if (pill) {
            return { 
              found: true, 
              selector: sel, 
              text: pill.textContent?.substring(0, 50),
              containerId: container.getAttribute('data-automation-id') || container.id
            };
          }
        }
        return { found: false, containerId: container.getAttribute('data-automation-id') || container.id };
      });
      
      if (existingPill.noContainer) {
        console.log(`  │   ⚠️ Could not find field container`);
      } else {
        console.log(`  │   Container: ${existingPill.containerId}`);
      }
      
      if (existingPill.found) {
        console.log(`  │   Found pill in container: "${existingPill.text}" (${existingPill.selector})`);
        if (existingPill.text?.toLowerCase().includes(value.toLowerCase().substring(0, 10))) {
          console.log(`  │ ⏭️ Already has correct value - skipping`);
          console.log(`  └─── END DEBUG ───\n`);
          return { success: true, skipped: true };
        }
      } else {
        console.log(`  │   No existing selection found in container`);
      }
      
      // STEP: Close any existing popups first
      console.log(`  │`);
      console.log(`  │ ACTION: Closing any existing popups (Escape)...`);
      await page.keyboard.press('Escape');
      await sleep(200);
      
      // STEP: Click to focus
      console.log(`  │ ACTION: Click to focus...`);
      await input.click();
      await sleep(300);
      
      // Check what's focused
      const focusedAfterClick = await page.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName, id: el?.id, type: el?.type };
      });
      console.log(`  │   → Focused: <${focusedAfterClick.tag?.toLowerCase()}> id="${focusedAfterClick.id}"`);
      
      // Clear existing text
      console.log(`  │ ACTION: Ctrl+A to select all...`);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await sleep(50);
      
      // Type search term
      const searchTerm = String(value).substring(0, 25);
      console.log(`  │ ACTION: Typing search term "${searchTerm}"...`);
      await page.keyboard.type(searchTerm, { delay: 50 });  // Slower typing
      await sleep(1000);  // Wait longer for dropdown to filter
      
      // Check what dropdown options appeared
      console.log(`  │`);
      console.log(`  │ SEARCHING FOR DROPDOWN OPTIONS...`);
      
      const dropdownInfo = await input.evaluate((inputEl, searchVal) => {
        // Find the popup associated with THIS input's container
        const fieldContainer = inputEl.closest('[data-automation-id*="formField"]') || 
                               inputEl.parentElement?.parentElement?.parentElement;
        
        // Look for popup/listbox that appeared after this input
        // Workday typically creates popups as siblings or within the same form area
        let popup = null;
        
        // First try: look for popup within the field container
        if (fieldContainer) {
          popup = fieldContainer.querySelector('[role="listbox"], [data-automation-id*="dropdown"], [data-automation-id="searchResults"]');
        }
        
        // Second try: look for any visible popup on the page
        if (!popup) {
          const allPopups = document.querySelectorAll('[role="listbox"], [data-automation-id*="dropdown"]');
          for (const p of allPopups) {
            if (p.getBoundingClientRect().height > 0) {
              popup = p;
              break;
            }
          }
        }
        
        const optionSelectors = [
          '[data-automation-id="promptOption"]',
          '[role="option"]',
          '[data-automation-id="selectOption"]'
        ];
        
        const results = [];
        const searchLower = searchVal.toLowerCase();
        
        // Search for options - prefer within popup if found
        const searchRoot = popup || document;
        
        for (const sel of optionSelectors) {
          const opts = searchRoot.querySelectorAll(sel);
          
          if (opts.length > 0) {
            const optionList = Array.from(opts)
              .filter(o => o.getBoundingClientRect().height > 0) // Only visible options
              .filter(o => {
                // Exclude country phone codes
                const text = o.textContent?.trim() || '';
                return !(text.includes('(+') && text.includes(')'));
              })
              .map(o => {
                const text = o.textContent?.trim() || '';
                return {
                  text: text.substring(0, 60),
                  matchesSearch: text.toLowerCase().includes(searchLower),
                  // Also check for partial matches
                  partialMatch: searchLower.split(' ').some(word => 
                    word.length > 2 && text.toLowerCase().includes(word)
                  )
                };
              });
            
            if (optionList.length > 0) {
              results.push({
                selector: sel,
                count: optionList.length,
                inPopup: !!popup,
                options: optionList.slice(0, 10)
              });
            }
          }
        }
        
        // Also check for "no results" message
        const noResults = document.querySelector('[data-automation-id="noResultsFound"], [class*="noResults"], [class*="empty"]');
        
        return {
          foundOptions: results,
          popupFound: !!popup,
          popupInContainer: !!fieldContainer?.querySelector('[role="listbox"]'),
          noResultsMessage: noResults?.textContent?.substring(0, 50),
          fieldContainerId: fieldContainer?.getAttribute('data-automation-id') || '(unknown)'
        };
      }, value);
      
      console.log(`  │   Field container: ${dropdownInfo.fieldContainerId}`);
      console.log(`  │   Popup found: ${dropdownInfo.popupFound} (in container: ${dropdownInfo.popupInContainer})`);
      
      if (dropdownInfo.noResultsMessage) {
        console.log(`  │   ⚠️ No results message: "${dropdownInfo.noResultsMessage}"`);
      }
      
      if (dropdownInfo.foundOptions.length === 0) {
        console.log(`  │   ❌ No dropdown options found!`);
      } else {
        for (const group of dropdownInfo.foundOptions) {
          console.log(`  │   Found ${group.count} visible options with selector: ${group.selector}`);
          for (const opt of group.options) {
            const marker = opt.matchesSearch ? '→' : (opt.partialMatch ? '~' : ' ');
            console.log(`  │   ${marker} "${opt.text}"`);
          }
        }
      }
      
      if (dropdownInfo.noResultsMessage) {
        console.log(`  │   ⚠️ No results message: "${dropdownInfo.noResultsMessage}"`);
      }
      
      if (dropdownInfo.foundOptions.length === 0) {
        console.log(`  │   ❌ No dropdown options found!`);
      } else {
        for (const group of dropdownInfo.foundOptions) {
          console.log(`  │   Found ${group.count} options with selector: ${group.selector}`);
          for (const opt of group.options) {
            const marker = opt.matchesSearch ? '→' : ' ';
            const vis = opt.visible ? '' : ' [HIDDEN]';
            console.log(`  │   ${marker} "${opt.text}"${vis}`);
          }
        }
      }
      
      // AI-DRIVEN OPTION SELECTION
      // Strategy 1: Exact match
      // Strategy 2: AI analyzes all options to find best semantic match
      // Strategy 3: Handle nested dropdowns by repeating AI analysis
      console.log(`  │`);
      console.log(`  │ AI-DRIVEN OPTION SELECTION...`);
      
      const MAX_NESTING_DEPTH = 3;
      let depth = 0;
      let selectedText = '';
      let selectionSuccess = false;
      let previousOptionsKey = ''; // Track options to detect loops
      
      while (depth < MAX_NESTING_DEPTH && !selectionSuccess) {
        depth++;
        console.log(`  │`);
        console.log(`  │ [Depth ${depth}] Collecting visible options...`);
        
        // Wait a moment for any animations/sub-menus to appear
        await sleep(400);
        
        // Collect all visible options, including nested sub-options
        const visibleOptions = await page.evaluate(() => {
          const optionSelectors = [
            '[data-automation-id="promptOption"]',
            '[role="option"]',
            '[data-automation-id="selectOption"]',
            // Additional selectors for sub-options
            '[data-automation-id*="subOption"]',
            '[data-automation-id*="child"]',
            'li[role="option"]',
            '[role="menuitem"]',
            '[role="treeitem"]'
          ];
          
          const options = [];
          const seen = new Set();
          
          for (const sel of optionSelectors) {
            const elements = document.querySelectorAll(sel);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              
              // Get ONLY the direct text, not text from nested children
              // This prevents getting "Job BoardLinkedInIndeed..." as one option
              let text = '';
              for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += node.textContent;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                  // Check if this child is itself an option (don't include its text)
                  const isNestedOption = node.matches?.('[data-automation-id="promptOption"], [role="option"]');
                  if (!isNestedOption) {
                    // Include text from non-option children (like spans for formatting)
                    // But only direct text, not deeply nested
                    const childText = node.textContent || '';
                    // If child text is short and doesn't contain multiple option-like entries
                    if (childText.length < 100 && !childText.includes('\n')) {
                      text += childText;
                    }
                  }
                }
              }
              text = text.trim();
              
              // Fallback: if direct text is empty, try getting just first meaningful text
              if (!text || text.length === 0) {
                // Try to get text from first text-containing child that's not another option
                const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                const firstText = walker.nextNode();
                if (firstText) {
                  text = firstText.textContent.trim();
                }
              }
              
              // If still no text, use full textContent but limit length
              if (!text || text.length === 0) {
                text = (el.textContent || '').trim();
                // If it contains newlines, it probably has nested options - just take first line
                if (text.includes('\n')) {
                  text = text.split('\n')[0].trim();
                }
              }
              
              // Skip country phone codes (they contain "(+")
              const isCountryCode = text.includes('(+') && text.includes(')');
              
              // Skip empty, too short, too long, duplicates, country codes
              if (rect.height > 0 && rect.width > 0 && 
                  text.length >= 2 && text.length < 100 && 
                  !seen.has(text) && !isCountryCode) {
                seen.add(text);
                
                // Check nesting level (useful for debugging)
                const depth = el.closest('[data-automation-id="promptOption"]') !== el ? 
                              (el.closest('[data-automation-id="promptOption"]') ? 'nested' : 'top') : 'top';
                
                options.push({
                  text: text,
                  selector: sel,
                  index: options.length,
                  depth: depth
                });
              }
            }
          }
          
          return options;
        });
        
        if (visibleOptions.length === 0) {
          console.log(`  │   No visible options found`);
          break;
        }
        
        // Create a key from current options to detect loops
        const currentOptionsKey = visibleOptions.map(o => o.text).sort().join('|');
        
        if (currentOptionsKey === previousOptionsKey && depth > 1) {
          console.log(`  │   ⚠️ Same options as before - click may have just highlighted, not opened sub-menu`);
          console.log(`  │   Trying keyboard selection: ArrowDown then Enter...`);
          
          // The previous click might have just highlighted "Job Board" but not expanded/selected it
          // Try using keyboard to navigate and select
          await page.keyboard.press('Enter');
          await sleep(400);
          
          // Check if pill appeared now
          const pillCheck = await input.evaluate(el => {
            const container = el.closest('[data-automation-id*="formField"]') || 
                              el.parentElement?.parentElement?.parentElement;
            const pill = container?.querySelector('[data-automation-id="selectedItem"]');
            return { found: !!pill, text: pill?.textContent?.trim() };
          });
          
          if (pillCheck.found) {
            console.log(`  │   ✅ Enter key worked! Pill: "${pillCheck.text}"`);
            selectionSuccess = true;
            selectedText = pillCheck.text;
            break;
          }
          
          // If Enter didn't work, maybe we need to select the highlighted option differently
          // Try Tab to confirm selection
          console.log(`  │   Enter didn't create pill. Trying Tab...`);
          await page.keyboard.press('Tab');
          await sleep(300);
          
          const pillCheck2 = await input.evaluate(el => {
            const container = el.closest('[data-automation-id*="formField"]') || 
                              el.parentElement?.parentElement?.parentElement;
            const pill = container?.querySelector('[data-automation-id="selectedItem"]');
            return { found: !!pill, text: pill?.textContent?.trim() };
          });
          
          if (pillCheck2.found) {
            console.log(`  │   ✅ Tab worked! Pill: "${pillCheck2.text}"`);
            selectionSuccess = true;
            selectedText = pillCheck2.text;
            break;
          }
          
          console.log(`  │   Neither Enter nor Tab worked. Breaking to avoid infinite loop.`);
          break;
        }
        
        previousOptionsKey = currentOptionsKey;
        
        console.log(`  │   Found ${visibleOptions.length} options:`);
        for (const opt of visibleOptions.slice(0, 15)) {
          const depthMarker = opt.depth === 'nested' ? '  ↳ ' : '';
          console.log(`  │     ${depthMarker}- "${opt.text.substring(0, 50)}"`);
        }
        if (visibleOptions.length > 15) {
          console.log(`  │     ... and ${visibleOptions.length - 15} more`);
        }
        
        // Strategy 1: Check for exact match first
        const searchLower = value.toLowerCase();
        const exactMatch = visibleOptions.find(opt => 
          opt.text.toLowerCase().includes(searchLower) || 
          searchLower.includes(opt.text.toLowerCase())
        );
        
        if (exactMatch) {
          console.log(`  │   ✓ Exact match found: "${exactMatch.text}"`);
          
          // Click the exact match - use more comprehensive selectors
          const clicked = await page.evaluate((targetText) => {
            const allSelectors = [
              '[data-automation-id="promptOption"]',
              '[role="option"]',
              '[data-automation-id*="option"]',
              '[role="menuitem"]',
              '[role="treeitem"]',
              'li[role="option"]'
            ];
            
            // First pass: look for exact text match
            for (const sel of allSelectors) {
              const options = document.querySelectorAll(sel);
              for (const opt of options) {
                const rect = opt.getBoundingClientRect();
                if (rect.height <= 0) continue;
                
                // Get direct text content
                let optText = '';
                for (const node of opt.childNodes) {
                  if (node.nodeType === Node.TEXT_NODE) {
                    optText += node.textContent;
                  } else if (node.nodeType === Node.ELEMENT_NODE && 
                             !node.matches('[data-automation-id="promptOption"], [role="option"]')) {
                    optText += node.textContent || '';
                  }
                }
                optText = optText.trim();
                
                // Also try full textContent for single-line options
                const fullText = opt.textContent?.trim() || '';
                const firstLine = fullText.split('\n')[0].trim();
                
                if (optText === targetText || firstLine === targetText || fullText === targetText) {
                  opt.click();
                  return { clicked: true, method: 'exact' };
                }
              }
            }
            
            // Second pass: look for contains match (for partial text)
            for (const sel of allSelectors) {
              const options = document.querySelectorAll(sel);
              for (const opt of options) {
                const rect = opt.getBoundingClientRect();
                if (rect.height <= 0) continue;
                
                const fullText = opt.textContent?.trim() || '';
                if (fullText.toLowerCase().includes(targetText.toLowerCase())) {
                  opt.click();
                  return { clicked: true, method: 'contains' };
                }
              }
            }
            
            return { clicked: false };
          }, exactMatch.text);
          
          if (clicked.clicked) {
            console.log(`  │   Clicked via ${clicked.method} match`);
            await sleep(400);
            selectedText = exactMatch.text;
            
            // Check if selection completed
            const pillCheck = await input.evaluate(el => {
              const container = el.closest('[data-automation-id*="formField"]') || 
                                el.parentElement?.parentElement?.parentElement;
              const pill = container?.querySelector('[data-automation-id="selectedItem"]');
              return { found: !!pill, text: pill?.textContent?.trim() };
            });
            
            if (pillCheck.found) {
              console.log(`  │   ✅ Exact match selected! Pill: "${pillCheck.text}"`);
              selectionSuccess = true;
              selectedText = pillCheck.text;
              continue;
            }
          }
        } else {
          // Strategy 2: Use AI to find best semantic match
          console.log(`  │   No exact match. Using AI to find best semantic match...`);
          console.log(`  │   Target: "${value}" (for field: "${label}")`);
          
          // Build context for AI classification
          const optionTexts = visibleOptions.map(o => o.text);
          
          // Use the classifier to find best match
          const aiMatchResult = await WorkdayPlatform.findBestOptionWithAI(
            value, 
            label, 
            optionTexts,
            classifier
          );
          
          if (aiMatchResult.bestMatch) {
            console.log(`  │   🤖 AI selected: "${aiMatchResult.bestMatch}" (confidence: ${(aiMatchResult.confidence * 100).toFixed(1)}%)`);
            
            // Click the AI-selected option - use improved clicking
            const clicked = await page.evaluate((targetText) => {
              const allSelectors = [
                '[data-automation-id="promptOption"]',
                '[role="option"]',
                '[data-automation-id*="option"]',
                '[role="menuitem"]',
                '[role="treeitem"]',
                'li[role="option"]'
              ];
              
              // First pass: exact match
              for (const sel of allSelectors) {
                const options = document.querySelectorAll(sel);
                for (const opt of options) {
                  const rect = opt.getBoundingClientRect();
                  if (rect.height <= 0) continue;
                  
                  // Get direct text
                  let optText = '';
                  for (const node of opt.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                      optText += node.textContent;
                    } else if (node.nodeType === Node.ELEMENT_NODE && 
                               !node.matches('[data-automation-id="promptOption"], [role="option"]')) {
                      optText += node.textContent || '';
                    }
                  }
                  optText = optText.trim();
                  
                  const fullText = opt.textContent?.trim() || '';
                  const firstLine = fullText.split('\n')[0].trim();
                  
                  if (optText === targetText || firstLine === targetText || fullText === targetText) {
                    opt.click();
                    return { clicked: true, method: 'exact' };
                  }
                }
              }
              
              // Second pass: contains match
              for (const sel of allSelectors) {
                const options = document.querySelectorAll(sel);
                for (const opt of options) {
                  const rect = opt.getBoundingClientRect();
                  if (rect.height <= 0) continue;
                  
                  const fullText = opt.textContent?.trim() || '';
                  if (fullText.toLowerCase().includes(targetText.toLowerCase())) {
                    opt.click();
                    return { clicked: true, method: 'contains' };
                  }
                }
              }
              
              return { clicked: false };
            }, aiMatchResult.bestMatch);
            
            if (clicked.clicked) {
              console.log(`  │   Clicked "${aiMatchResult.bestMatch}" via ${clicked.method} match`);
              await sleep(400);
              selectedText = aiMatchResult.bestMatch;
            }
          } else {
            console.log(`  │   ⚠️ AI could not find a suitable match`);
            break;
          }
        }
        
        // Check if selection was successful (pill appeared) or if we have nested options
        const stateAfterClick = await input.evaluate(el => {
          const container = el.closest('[data-automation-id*="formField"]') || 
                            el.parentElement?.parentElement?.parentElement;
          
          // Check for pill
          const pill = container?.querySelector('[data-automation-id="selectedItem"], [data-automation-id="multiSelectItem"]');
          
          // Check if dropdown is still open (nested options)
          const stillOpen = document.querySelectorAll('[data-automation-id="promptOption"]:not([style*="display: none"])').length > 0 ||
                           document.querySelectorAll('[role="option"]').length > 0;
          
          // Count visible options now
          const currentOptions = document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
          let visibleCount = 0;
          currentOptions.forEach(o => {
            if (o.getBoundingClientRect().height > 0) visibleCount++;
          });
          
          return {
            pillFound: !!pill,
            pillText: pill?.textContent?.trim().substring(0, 50),
            dropdownStillOpen: stillOpen,
            visibleOptionsCount: visibleCount
          };
        });
        
        console.log(`  │   After click: pill=${stateAfterClick.pillFound}, dropdown open=${stateAfterClick.dropdownStillOpen}, options=${stateAfterClick.visibleOptionsCount}`);
        
        if (stateAfterClick.pillFound) {
          console.log(`  │   ✅ Pill appeared: "${stateAfterClick.pillText}"`);
          selectionSuccess = true;
          selectedText = stateAfterClick.pillText;
        } else if (stateAfterClick.dropdownStillOpen && stateAfterClick.visibleOptionsCount > 0) {
          console.log(`  │   ↳ Dropdown still open, checking for new/nested options at depth ${depth + 1}...`);
          // Loop will continue to check for new options
        } else {
          console.log(`  │   ⚠️ Click didn't result in selection or new options`);
          break;
        }
      }
      
      // Close any remaining dropdown
      await page.keyboard.press('Escape');
      await sleep(100);
      
      // Close popup
      await page.keyboard.press('Escape');
      await sleep(100);
      
      // FINAL STATE CHECK - look in THIS field's container
      console.log(`  │`);
      console.log(`  │ FINAL STATE CHECK...`);
      
      const finalState = await input.evaluate((el, searchVal) => {
        // Find this field's container
        const container = el.closest('[data-automation-id*="formField"]') || 
                          el.closest('[data-automation-id*="source"]') ||
                          el.parentElement?.parentElement?.parentElement;
        
        // Check for selected pill IN THIS CONTAINER
        let pillText = null;
        let pillFound = false;
        
        if (container) {
          const pill = container.querySelector('[data-automation-id="selectedItem"], [data-automation-id="multiSelectItem"]');
          if (pill) {
            pillFound = true;
            pillText = pill.textContent?.trim().substring(0, 50);
          }
        }
        
        // Also check the input value itself
        const inputValue = el.value || '';
        
        return {
          pillText: pillText,
          pillFound: pillFound,
          inputValue: inputValue,
          containerId: container?.getAttribute('data-automation-id') || container?.id || '(unknown)'
        };
      }, value);
      
      console.log(`  │   Container: ${finalState.containerId}`);
      console.log(`  │   Pill found in container: ${finalState.pillFound}`);
      if (finalState.pillFound) {
        console.log(`  │   Pill text: "${finalState.pillText}"`);
      }
      console.log(`  │   Input value: "${finalState.inputValue}"`);
      
      // Use the selection result from the AI-driven selection loop
      const success = selectionSuccess || (finalState.pillFound && finalState.pillText && finalState.pillText.length > 0);
      const finalSelectedText = selectedText || finalState.pillText || '';
      
      console.log(`  │`);
      if (success) {
        console.log(`  │ ✅ SUCCESS - "${finalSelectedText}" selected`);
        console.log(`  └─── END DEBUG ───\n`);
        console.log(`  ✅ ${label}: "${finalSelectedText}"`);
        return { success: true, selected: finalSelectedText };
      } else {
        console.log(`  │ ❌ FAILED - No selection confirmed`);
        console.log(`  │   Searched for: "${value}"`);
        console.log(`  │   Selected: "${finalSelectedText || '(none)'}"`);
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, selected: null };
      }
      
    } catch (e) {
      await page.keyboard.press('Escape').catch(() => {});
      console.log(`  │ ❌ ERROR: ${e.message}`);
      console.log(`  └─── END DEBUG ───\n`);
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill radio button group with debugging
   * Clicks the correct radio based on Yes/No value
   */
  async fillRadio(page, selector, value, label) {
    console.log(`\n  ┌─── DEBUG: fillRadio("${label}") ───`);
    console.log(`  │ Selector: ${selector}`);
    console.log(`  │ Value: "${value}"`);
    
    try {
      const wantYes = String(value).toLowerCase() === 'yes' || value === true || value === 'true';
      const targetValue = wantYes ? 'true' : 'false';
      const labelText = wantYes ? 'Yes' : 'No';
      
      console.log(`  │ Looking for: ${labelText} (value="${targetValue}")`);
      
      // Extract the name from selector like 'input[name="candidateIsPreviousWorker"]'
      const nameMatch = selector.match(/name="([^"]+)"/);
      const radioName = nameMatch ? nameMatch[1] : null;
      console.log(`  │ Radio group name: ${radioName || '(could not extract)'}`);
      
      // Search for all radio buttons in the page
      console.log(`  │`);
      console.log(`  │ SEARCHING FOR ALL RADIO BUTTONS...`);
      
      const allRadios = await page.evaluate((name) => {
        const radios = document.querySelectorAll('input[type="radio"]');
        return Array.from(radios).map(r => ({
          id: r.id,
          name: r.name,
          value: r.value,
          checked: r.checked,
          dataAutomationId: r.getAttribute('data-automation-id'),
          visible: r.getBoundingClientRect().height > 0,
          labelText: r.labels?.[0]?.textContent?.trim() || document.querySelector(`label[for="${r.id}"]`)?.textContent?.trim() || ''
        }));
      }, radioName);
      
      console.log(`  │ Found ${allRadios.length} radio button(s):`);
      for (const r of allRadios) {
        const marker = r.name === radioName ? '→' : ' ';
        const checked = r.checked ? ' [CHECKED]' : '';
        console.log(`  │ ${marker} name="${r.name}" value="${r.value}" label="${r.labelText}"${checked}`);
      }
      
      // Filter to relevant radios
      const relevantRadios = allRadios.filter(r => r.name === radioName);
      console.log(`  │`);
      console.log(`  │ Relevant radios (name="${radioName}"): ${relevantRadios.length}`);
      
      // Try to find the specific radio button by value
      const radioSelectors = [
        `input[name="${radioName}"][value="${targetValue}"]`,
        `${selector}[value="${targetValue}"]`,
      ];
      
      for (const radioSel of radioSelectors) {
        console.log(`  │ Trying selector: ${radioSel}`);
        try {
          const radio = await page.$(radioSel);
          if (radio) {
            console.log(`  │   ✓ Found element`);
            
            // Check if already selected
            const isChecked = await radio.evaluate(el => el.checked);
            console.log(`  │   Already checked: ${isChecked}`);
            
            if (isChecked) {
              console.log(`  │ ⏭️ Already has correct value`);
              console.log(`  └─── END DEBUG ───\n`);
              return { success: true, selected: labelText, skipped: true };
            }
            
            // Click the radio
            console.log(`  │ ACTION: Clicking radio button...`);
            await radio.click();
            await sleep(200);
            
            // Verify click worked
            const nowChecked = await radio.evaluate(el => el.checked);
            console.log(`  │   Now checked: ${nowChecked}`);
            
            if (nowChecked) {
              console.log(`  │ ✅ SUCCESS - Radio selected`);
              console.log(`  └─── END DEBUG ───\n`);
              console.log(`  ✅ ${label}: "${labelText}"`);
              return { success: true, selected: labelText };
            } else {
              console.log(`  │ ⚠️ Click didn't select the radio!`);
            }
          } else {
            console.log(`  │   ✗ Not found`);
          }
        } catch (e) {
          console.log(`  │   Error: ${e.message}`);
        }
      }
      
      // Fallback: Try clicking the label directly
      console.log(`  │`);
      console.log(`  │ FALLBACK: Trying to click label with text "${labelText}"...`);
      
      try {
        const labels = await page.$$('label');
        console.log(`  │ Found ${labels.length} label elements`);
        
        for (const lbl of labels) {
          const text = await lbl.evaluate(el => el.textContent || '');
          if (text.toLowerCase().includes(labelText.toLowerCase())) {
            console.log(`  │   Found matching label: "${text.trim().substring(0, 30)}"`);
            await lbl.click();
            await sleep(200);
            
            // Verify
            const finalCheck = await page.evaluate((name, target) => {
              const radio = document.querySelector(`input[name="${name}"][value="${target}"]`);
              return radio?.checked;
            }, radioName, targetValue);
            
            console.log(`  │   After clicking label, radio checked: ${finalCheck}`);
            
            if (finalCheck) {
              console.log(`  │ ✅ SUCCESS via label click`);
              console.log(`  └─── END DEBUG ───\n`);
              console.log(`  ✅ ${label}: "${labelText}" (via label)`);
              return { success: true, selected: labelText };
            }
          }
        }
      } catch (e) {
        console.log(`  │   Error: ${e.message}`);
      }
      
      console.log(`  │ ❌ FAILED - Could not select radio`);
      console.log(`  └─── END DEBUG ───\n`);
      console.log(`  ❌ ${label}: Could not find radio option`);
      return { success: false, error: 'No matching option' };
      
    } catch (e) {
      console.log(`  │ ❌ ERROR: ${e.message}`);
      console.log(`  └─── END DEBUG ───\n`);
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill a single checkbox
   */
  async fillCheckbox(page, selector, shouldCheck, label) {
    try {
      const cb = await page.$(selector);
      if (!cb) {
        console.log(`  ❌ ${label}: Not found`);
        return { success: false, error: 'Not found' };
      }
      
      // Check current state - Puppeteer compatible
      const isChecked = await cb.evaluate(el => el.checked);
      
      if (isChecked !== shouldCheck) {
        // Click to toggle
        await cb.click();
        await sleep(100);
      }
      
      console.log(`  ✅ ${label}: ${shouldCheck ? 'checked' : 'unchecked'}`);
      return { success: true, checked: shouldCheck };
      
    } catch (e) {
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill a checkbox group (like ethnicity, disability status)
   * Finds the checkbox with matching label text and clicks it
   */
  async fillCheckboxGroup(page, selector, value, label, classifier = null) {
    try {
      const fieldset = await page.$(selector);
      if (!fieldset) {
        console.log(`  ❌ ${label}: Not found`);
        return { success: false, error: 'Not found' };
      }
      
      const valLower = String(value).toLowerCase();
      
      // Get all labels within the fieldset and find matching one - Puppeteer compatible
      const labels = await page.$$(`${selector} label`);
      
      for (const lbl of labels) {
        try {
          const text = await lbl.evaluate(el => el.textContent || '');
          const textLower = text.toLowerCase();
          
          // Check for various matches
          let isMatch = false;
          
          // Simple Yes/No match
          if (valLower === 'yes' && textLower.trim() === 'yes') isMatch = true;
          if (valLower === 'no' && textLower.trim() === 'no') isMatch = true;
          
          // Longer text matches
          if (valLower.includes('no') && valLower.includes('do not') && textLower.includes('no, i do not')) isMatch = true;
          if (valLower.includes('yes') && valLower.includes('have') && textLower.includes('yes, i have')) isMatch = true;
          if ((valLower.includes('do not want') || valLower.includes("don't want")) && textLower.includes('do not want to answer')) isMatch = true;
          
          // Generic partial match
          if (textLower.includes(valLower.substring(0, 20))) isMatch = true;
          
          if (isMatch) {
            // Check visibility - Puppeteer compatible
            const isVisible = await lbl.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            
            if (isVisible) {
              await lbl.click();
              await sleep(100);
              console.log(`  ✅ ${label}: "${text.substring(0, 40).trim()}..."`);
              return { success: true, selected: text.trim() };
            }
          }
        } catch (e) {
          // Try next
        }
      }
      
      console.log(`  ❌ ${label}: No matching option for "${value}"`);
      return { success: false, error: 'No matching option' };
      
    } catch (e) {
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Fill country phone code (special searchable)
   */
  async fillCountryPhoneCode(page, label) {
    try {
      // Find the phone code input
      const selector = '#phoneNumber--countryPhoneCode';
      let input = await page.$(selector);
      
      if (!input) {
        // Try alternative selector
        input = await page.$('input[id*="countryPhoneCode"]');
        if (!input) {
          console.log(`  ⏭️ ${label}: Not found (may be pre-filled)`);
          return { success: true, skipped: true };
        }
      }
      
      // Check if already has US selected by looking for the pill
      try {
        const pillText = await page.$eval('[data-automation-id="selectedItem"]', el => el.textContent);
        if (pillText && (pillText.includes('United States') || pillText.includes('+1'))) {
          console.log(`  ⏭️ ${label}: Already selected`);
          return { success: true, skipped: true };
        }
      } catch (e) {
        // No pill, continue
      }
      
      // Click and type to search
      await input.click();
      await sleep(300);
      await page.type(selector, 'United States', { delay: 30 });
      await sleep(600);
      
      // Click first matching option
      const opt = await page.$('[data-automation-id="promptOption"]');
      if (opt) {
        await opt.click();
        await sleep(200);
        console.log(`  ✅ ${label}: "United States of America (+1)"`);
        return { success: true, selected: 'United States of America (+1)' };
      }
      
      // Keyboard fallback
      await page.keyboard.press('ArrowDown');
      await sleep(100);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      
      console.log(`  ✅ ${label}: (first option)`);
      return { success: true };
      
    } catch (e) {
      await page.keyboard.press('Escape').catch(() => {});
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  /**
   * Upload resume file
   */
  async uploadResume(page, resumePath, label) {
    if (!resumePath) {
      console.log(`  ⏭️ ${label}: No path configured`);
      return { success: false, skipped: true };
    }
    
    try {
      // Check if already uploaded
      const uploaded = await page.$('[data-automation-id="file-upload-successful"]');
      if (uploaded) {
        console.log(`  ⏭️ ${label}: Already uploaded`);
        return { success: true, skipped: true };
      }
      
      const btn = await page.$(this.selectors.resumeButton);
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
        await input.setInputFiles(resumePath);
        console.log(`  ✅ ${label}: Uploaded (generic)`);
        return { success: true };
      }
      
      console.log(`  ⏭️ ${label}: No upload button found`);
      return { success: false, error: 'No upload button' };
      
    } catch (e) {
      console.log(`  ❌ ${label}: ${e.message}`);
      return { success: false, error: e.message };
    }
  },

  // ============================================
  // VALUE MAPPERS - Convert profile values to Workday format
  // ============================================
  mappers: {
    degree: (profileDegree) => {
      const d = (profileDegree || '').toLowerCase();
      if (d.includes('master')) return "Master's Degree";
      if (d.includes('bachelor')) return "Bachelor's Degree";
      if (d.includes('phd') || d.includes('doctor')) return 'Doctorate';
      if (d.includes('associate')) return "Associate's Degree";
      if (d.includes('high school')) return 'High School or Equivalent';
      return profileDegree || "Bachelor's Degree";
    },
    
    gender: (profileGender) => {
      const g = (profileGender || '').toLowerCase();
      if (g.includes('male') && !g.includes('female')) return 'Male';
      if (g.includes('female')) return 'Female';
      return 'Decline to Self Identify';
    },
    
    ethnicity: (profileEthnicity) => {
      const e = (profileEthnicity || '').toLowerCase();
      if (e.includes('asian')) return 'Asian';
      if (e.includes('black') || e.includes('african')) return 'Black or African American';
      if (e.includes('hispanic') || e.includes('latino')) return 'Hispanic or Latino';
      if (e.includes('white') || e.includes('caucasian')) return 'White';
      return 'Decline to Self Identify';
    },
    
    veteranStatus: (profileVeteran) => {
      const v = (profileVeteran || '').toLowerCase();
      if (v.includes('not') || !v || v.includes('no')) return 'I am not a protected veteran';
      return 'I am not a protected veteran';
    },
    
    disabilityStatus: (profileDisability) => {
      const d = (profileDisability || '').toLowerCase();
      if (d.includes('yes')) return 'Yes, I have a disability';
      if (d.includes('not want') || d.includes("don't want")) return 'I do not want to answer';
      return 'No, I do not have a disability and have not had one in the past';
    },
    
    phone: (profilePhone) => {
      if (!profilePhone) return '';
      return profilePhone.replace(/^\+?1?\s*/, '').replace(/[\(\)\-\s]/g, '');
    }
  },

  /**
   * AI-DRIVEN OPTION MATCHING
   * Uses semantic similarity to find the best match from a list of options
   * 
   * @param {string} targetValue - What we're looking for (e.g., "LinkedIn")
   * @param {string} fieldLabel - The field label (e.g., "How Did You Hear About Us?")
   * @param {string[]} options - List of available options
   * @param {object} classifier - The AI classifier instance (has access to semantic model)
   * @returns {object} { bestMatch: string, confidence: number }
   */
  async findBestOptionWithAI(targetValue, fieldLabel, options, classifier) {
    console.log(`  │     🤖 AI analyzing ${options.length} options for best match to "${targetValue}"...`);
    
    // STEP 1: Try comprehensive keyword matching FIRST (most reliable)
    const keywordResult = this.findBestOptionByKeywords(targetValue, fieldLabel, options);
    if (keywordResult.bestMatch && keywordResult.confidence >= 0.7) {
      console.log(`  │     ✓ Keyword match found: "${keywordResult.bestMatch}" (${(keywordResult.confidence * 100).toFixed(0)}%)`);
      return keywordResult;
    }
    
    // STEP 2: Try semantic similarity if available
    try {
      // Import the semantic similarity module dynamically
      const { SemanticSimilarity } = await import('./semantic-similarity.js');
      
      if (!SemanticSimilarity.model) {
        await SemanticSimilarity.loadModel();
      }
      
      // Get embedding for our target value (what we're looking for)
      const targetEmbedding = await SemanticSimilarity.getEmbedding(targetValue);
      
      // Score each option by semantic similarity
      const scoredOptions = [];
      
      for (const option of options) {
        const optionEmbedding = await SemanticSimilarity.getEmbedding(option);
        const similarity = SemanticSimilarity.cosineSimilarity(targetEmbedding, optionEmbedding);
        scoredOptions.push({ option, score: similarity });
      }
      
      // Sort by similarity (highest first)
      scoredOptions.sort((a, b) => b.score - a.score);
      
      console.log(`  │     Semantic similarity scores (top 5):`);
      for (const scored of scoredOptions.slice(0, 5)) {
        console.log(`  │       ${(scored.score * 100).toFixed(1)}% - "${scored.option.substring(0, 40)}"`);
      }
      
      // Return best match if similarity is reasonable
      if (scoredOptions.length > 0 && scoredOptions[0].score > 0.3) {
        return {
          bestMatch: scoredOptions[0].option,
          confidence: scoredOptions[0].score
        };
      }
    } catch (e) {
      console.log(`  │     Semantic similarity error: ${e.message}`);
    }
    
    // STEP 3: Fall back to keyword matching even with lower confidence
    if (keywordResult.bestMatch) {
      console.log(`  │     Using keyword fallback: "${keywordResult.bestMatch}"`);
      return keywordResult;
    }
    
    // No good match found
    console.log(`  │     ⚠️ No suitable match found`);
    return { bestMatch: null, confidence: 0 };
  },

  /**
   * KEYWORD-BASED OPTION MATCHING
   * Uses comprehensive keyword/synonym mapping
   */
  findBestOptionByKeywords(targetValue, fieldLabel, options) {
    const targetLower = targetValue.toLowerCase().trim();
    
    // COMPREHENSIVE MAPPINGS for "How Did You Hear About Us" type questions
    // Maps what user might say → what dropdown options might be called
    const knownMappings = {
      // Job Boards
      'linkedin': ['job board', 'linkedin', 'online job board', 'professional network', 'social media', 'online'],
      'indeed': ['job board', 'indeed', 'online job board', 'online', 'website'],
      'glassdoor': ['job board', 'glassdoor', 'online job board', 'online', 'website'],
      'monster': ['job board', 'monster', 'online job board', 'online'],
      'ziprecruiter': ['job board', 'ziprecruiter', 'online job board', 'online'],
      'dice': ['job board', 'dice', 'online job board', 'online', 'tech job board'],
      'careerbuilder': ['job board', 'careerbuilder', 'online job board', 'online'],
      'job board': ['job board', 'online job board', 'online', 'website'],
      
      // Social Media
      'facebook': ['social media', 'facebook', 'online', 'website'],
      'twitter': ['social media', 'twitter', 'online', 'website'],
      'instagram': ['social media', 'instagram', 'online'],
      'social media': ['social media', 'online', 'website'],
      
      // Referrals
      'referral': ['employee referral', 'referral', 'friend', 'colleague', 'referred by employee'],
      'friend': ['employee referral', 'referral', 'friend', 'word of mouth'],
      'employee': ['employee referral', 'referral', 'current employee'],
      'colleague': ['employee referral', 'referral', 'colleague'],
      
      // Direct/Company
      'career site': ['career site', 'company website', 'careers page', 'website', 'direct'],
      'company website': ['career site', 'company website', 'website', 'direct'],
      'website': ['career site', 'website', 'online', 'company website'],
      'direct': ['contacted directly', 'direct', 'recruiter contacted'],
      
      // Recruiting
      'recruiter': ['recruiter', 'headhunter', 'staffing', 'agency', 'contacted directly'],
      'headhunter': ['recruiter', 'headhunter', 'staffing', 'agency'],
      'agency': ['agency', 'staffing', 'recruiter', 'staffing agency'],
      
      // Education/Events
      'university': ['university', 'college', 'campus', 'school', 'career fair', 'university relations'],
      'college': ['university', 'college', 'campus', 'school', 'university relations'],
      'career fair': ['career fair', 'university', 'campus', 'job fair', 'event'],
      'conference': ['conference', 'event', 'meetup', 'trade show', 'professional event'],
      'event': ['event', 'conference', 'career fair', 'meetup'],
      
      // Other
      'other': ['other', 'not listed', 'different source'],
      'google': ['search engine', 'google', 'online search', 'internet search', 'online'],
      'search': ['search engine', 'online search', 'google', 'online']
    };
    
    // First: Check if target directly matches any option
    for (const option of options) {
      if (option.toLowerCase().includes(targetLower) || targetLower.includes(option.toLowerCase())) {
        console.log(`  │     ✓ Direct match: "${option}"`);
        return { bestMatch: option, confidence: 0.95 };
      }
    }
    
    // Second: Check known mappings
    for (const [key, synonyms] of Object.entries(knownMappings)) {
      // Check if target matches this key
      if (targetLower.includes(key) || key.includes(targetLower)) {
        // Look for matching option
        for (const option of options) {
          const optionLower = option.toLowerCase();
          for (const synonym of synonyms) {
            if (optionLower.includes(synonym) || synonym.includes(optionLower)) {
              console.log(`  │     ✓ Synonym match: "${targetValue}" → "${key}" → "${synonym}" → "${option}"`);
              return { bestMatch: option, confidence: 0.85 };
            }
          }
        }
      }
    }
    
    // Third: Word overlap scoring
    const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
    
    const scoredOptions = options.map(option => {
      const optionLower = option.toLowerCase();
      const optionWords = optionLower.split(/\s+/).filter(w => w.length > 2);
      let score = 0;
      
      // Check word overlap
      for (const word of targetWords) {
        if (optionLower.includes(word)) score += 2;
      }
      for (const word of optionWords) {
        if (targetLower.includes(word)) score += 1;
      }
      
      return { option, score };
    });
    
    scoredOptions.sort((a, b) => b.score - a.score);
    
    if (scoredOptions.length > 0 && scoredOptions[0].score > 0) {
      return { 
        bestMatch: scoredOptions[0].option, 
        confidence: Math.min(scoredOptions[0].score / 5, 0.6) 
      };
    }
    
    return { bestMatch: null, confidence: 0 };
  }
};

export default WorkdayPlatform;
