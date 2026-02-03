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
      // CRITICAL: Close any open popups first (they can intercept clicks!)
      await page.keyboard.press('Escape');
      await sleep(100);
      
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
    const targetValue = valuesToTry[0];
    
    console.log(`  ┌─── DEBUG: fillDropdown("${label}") ───`);
    console.log(`  │ Selector: ${selector}`);
    console.log(`  │ Value to find: "${targetValue}"`);
    
    try {
      const btn = await page.$(selector);
      if (!btn) {
        console.log(`  │ ❌ Button not found`);
        console.log(`  └─── END DEBUG ───\n`);
        console.log(`  ❌ ${label}: Not found`);
        return { success: false, error: 'Not found' };
      }
      
      // CRITICAL: Scroll button into view BEFORE getting position
      await btn.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      
      // Get button position AFTER scrolling into view
      const btnRect = await btn.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
      });
      console.log(`  │ Button position: top=${btnRect.top.toFixed(0)}, left=${btnRect.left.toFixed(0)}`);
      
      // Sanity check - button should be visible now
      if (btnRect.top < 0 || btnRect.top > 800) {
        console.log(`  │ ⚠️ Button may not be visible, re-scrolling...`);
        await btn.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await sleep(200);
      }
      
      // Check if already has a value (not "Select One")
      const btnText = await btn.evaluate(el => el.textContent || '');
      console.log(`  │ Current button text: "${btnText.trim()}"`);
      
      const isAlreadyFilled = btnText && !btnText.toLowerCase().includes('select');
      if (isAlreadyFilled) {
        for (const v of valuesToTry) {
          if (btnText.toLowerCase().includes(v.toLowerCase())) {
            console.log(`  │ ⏭️ Already has matching value`);
            console.log(`  └─── END DEBUG ───\n`);
            console.log(`  ⏭️ ${label}: Already "${btnText.trim()}"`);
            return { success: true, selected: btnText.trim(), skipped: true };
          }
        }
      }
      
      // Close any existing popups first
      await page.keyboard.press('Escape');
      await sleep(200);
      
      // ============================================
      // STEP 1: TRY TYPING FOR EXACT MATCH FIRST
      // ============================================
      console.log(`  │`);
      console.log(`  │ STEP 1: Trying type-ahead for exact match...`);
      console.log(`  │ ACTION: Clicking to open dropdown...`);
      await btn.click();
      await sleep(400);
      
      // Type the value to filter
      console.log(`  │ ACTION: Typing "${targetValue}" to filter...`);
      await page.keyboard.type(targetValue, { delay: 30 });
      await sleep(500);
      
      // Check if we have a matching option - use position-based popup detection
      const typeAheadResult = await page.evaluate((target, buttonRect) => {
        const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
        
        // Find popup closest to button
        let bestPopup = null;
        let bestDistance = Infinity;
        
        for (const popup of popups) {
          const rect = popup.getBoundingClientRect();
          if (rect.height > 30 && rect.top >= 0) {
            const distance = Math.abs(rect.top - buttonRect.bottom) + Math.abs(rect.left - buttonRect.left);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestPopup = popup;
            }
          }
        }
        
        if (!bestPopup) return { found: false };
        
        // Search in the closest popup
        const options = bestPopup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
        for (const opt of options) {
          const optRect = opt.getBoundingClientRect();
          const optText = opt.textContent?.trim() || '';
          
          // Check for exact match (case-insensitive)
          if (optRect.height > 0 && optText.toLowerCase() === target.toLowerCase()) {
            return {
              found: true,
              exact: true,
              x: optRect.left + optRect.width / 2,
              y: optRect.top + optRect.height / 2,
              text: optText
            };
          }
          
          // Check for partial match
          if (optRect.height > 0 && optText.toLowerCase().includes(target.toLowerCase())) {
            return {
              found: true,
              exact: false,
              x: optRect.left + optRect.width / 2,
              y: optRect.top + optRect.height / 2,
              text: optText
            };
          }
        }
        return { found: false };
      }, targetValue, btnRect);
      
      if (typeAheadResult.found && typeAheadResult.exact) {
        // Only proceed if we found an EXACT match
        console.log(`  │   ✓ Found "${typeAheadResult.text}" (exact: ${typeAheadResult.exact})`);
        console.log(`  │   ACTION: Clicking at (${typeAheadResult.x.toFixed(0)}, ${typeAheadResult.y.toFixed(0)})...`);
        
        // Click with Puppeteer
        await page.mouse.click(typeAheadResult.x, typeAheadResult.y);
        await sleep(400);
        
        // Verify
        const newBtnText = await btn.evaluate(el => el.textContent || '').catch(() => '');
        if (newBtnText && !newBtnText.toLowerCase().includes('select')) {
          console.log(`  │   Button now shows: "${newBtnText.trim()}"`);
          console.log(`  │`);
          console.log(`  │ ✅ SUCCESS - "${newBtnText.trim()}" selected via type-ahead`);
          console.log(`  └─── END DEBUG ───\n`);
          console.log(`  ✅ ${label}: "${typeAheadResult.text}"`);
          return { success: true, selected: typeAheadResult.text };
        }
        
        console.log(`  │   ⚠️ Click didn't register, trying keyboard...`);
        // Try keyboard as fallback
        await page.keyboard.press('ArrowDown');
        await sleep(100);
        await page.keyboard.press('Enter');
        await sleep(300);
        
        const newBtnText2 = await btn.evaluate(el => el.textContent || '').catch(() => '');
        if (newBtnText2 && !newBtnText2.toLowerCase().includes('select')) {
          console.log(`  │   ✅ Keyboard selection worked: "${newBtnText2.trim()}"`);
          console.log(`  └─── END DEBUG ───\n`);
          console.log(`  ✅ ${label}: "${newBtnText2.trim()}"`);
          return { success: true, selected: newBtnText2.trim() };
        }
      } else if (typeAheadResult.found && !typeAheadResult.exact) {
        console.log(`  │   ⚠️ Found partial match "${typeAheadResult.text}" but need exact match for "${targetValue}"`);
        console.log(`  │   Proceeding to full scroll + AI matching...`);
      } else {
        console.log(`  │   No match found via type-ahead`);
      }
      
      // Clear and close, then try full scroll approach
      await page.keyboard.press('Escape');
      await sleep(200);
      await page.keyboard.press('Escape'); // Double escape to ensure all popups closed
      await sleep(200);
      
      // ============================================
      // STEP 2: FULL SCROLL + AI MATCHING (if type-ahead failed)
      // ============================================
      console.log(`  │`);
      console.log(`  │ STEP 2: Type-ahead didn't work, trying full scroll + AI...`);
      
      // Re-scroll button into view to ensure accurate positioning
      await btn.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await sleep(200);
      
      // Get FRESH button position
      const freshBtnRect = await btn.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, left: rect.left, bottom: rect.bottom };
      });
      console.log(`  │ Fresh button position: top=${freshBtnRect.top.toFixed(0)}, left=${freshBtnRect.left.toFixed(0)}`);
      
      console.log(`  │ ACTION: Re-opening dropdown...`);
      await btn.click();
      await sleep(600);
      
      // Find the CORRECT popup using FRESH position
      const popupInfo = await page.evaluate((buttonRect) => {
        const popupSelectors = ['[role="listbox"]', '[data-automation-id="selectBoxPopup"]', '[data-automation-id*="dropdown"]'];
        const foundPopups = [];
        
        for (const sel of popupSelectors) {
          const candidates = document.querySelectorAll(sel);
          for (let idx = 0; idx < candidates.length; idx++) {
            const el = candidates[idx];
            const rect = el.getBoundingClientRect();
            
            const style = window.getComputedStyle(el);
            const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden';
            const isOnScreen = rect.height > 30 && rect.top >= 0;
            
            if (isDisplayed && isOnScreen) {
              const distanceFromButton = Math.abs(rect.top - buttonRect.bottom) + Math.abs(rect.left - buttonRect.left);
              
              const options = el.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
              const visibleOpts = Array.from(options).filter(o => o.getBoundingClientRect().height > 0);
              
              foundPopups.push({
                index: idx,
                rect: { top: rect.top, left: rect.left, height: rect.height },
                distanceFromButton,
                optionCount: visibleOpts.length,
                sampleOptions: visibleOpts.slice(0, 5).map(o => o.textContent?.trim().substring(0, 30))
              });
            }
          }
        }
        
        foundPopups.sort((a, b) => a.distanceFromButton - b.distanceFromButton);
        return { popups: foundPopups };
      }, freshBtnRect);
      
      console.log(`  │ Found ${popupInfo.popups.length} visible popup(s):`);
      for (const p of popupInfo.popups) {
        console.log(`  │   - pos=(${p.rect.top.toFixed(0)},${p.rect.left.toFixed(0)}) dist=${p.distanceFromButton.toFixed(0)}px, ${p.optionCount} opts: ${p.sampleOptions?.slice(0, 3).join(', ')}`);
      }
      
      if (popupInfo.popups.length === 0) {
        console.log(`  │ ❌ No visible popup found`);
        await page.keyboard.press('Escape');
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: 'No popup found' };
      }
      
      // Smart popup selection:
      // 1. If one popup has significantly more options, prefer it (likely the correct dropdown)
      // 2. Otherwise use closest to button
      let targetPopup = popupInfo.popups[0];
      
      // Check if another popup has WAY more options (indicates it's the real dropdown)
      for (const p of popupInfo.popups) {
        if (p.optionCount > targetPopup.optionCount * 3 && p.optionCount >= 5) {
          console.log(`  │ ⚠️ Switching to popup with ${p.optionCount} options (vs ${targetPopup.optionCount})`);
          targetPopup = p;
          break;
        }
      }
      
      const popupTop = targetPopup.rect.top;
      const popupLeft = targetPopup.rect.left;
      console.log(`  │ Using popup at (${popupTop.toFixed(0)}, ${popupLeft.toFixed(0)}) with ${targetPopup.optionCount} options`);;
      
      // Collect ALL options
      const allOptions = new Set();
      let previousCount = 0;
      let noChangeCount = 0;
      const maxScrollAttempts = 50;
      
      for (let i = 0; i < maxScrollAttempts; i++) {
        const result = await page.evaluate((targetTop, targetLeft) => {
          const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
          
          for (const popup of popups) {
            const rect = popup.getBoundingClientRect();
            if (rect.height > 30 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
              const options = popup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
              const optionTexts = [];
              
              for (const opt of options) {
                const optRect = opt.getBoundingClientRect();
                if (optRect.height > 0) {
                  const text = opt.textContent?.trim() || '';
                  if (text.length >= 2 && text.length < 100 && !text.toLowerCase().includes('select')) {
                    optionTexts.push(text);
                  }
                }
              }
              
              let scrollContainer = popup;
              const isScrollable = (el) => {
                const style = window.getComputedStyle(el);
                return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
              };
              
              if (!isScrollable(popup)) {
                for (const child of popup.querySelectorAll('*')) {
                  if (isScrollable(child)) { scrollContainer = child; break; }
                }
              }
              
              const oldScroll = scrollContainer.scrollTop;
              scrollContainer.scrollTop += 150;
              const scrolled = scrollContainer.scrollTop > oldScroll;
              const atEnd = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 5;
              
              return { options: optionTexts, scrolled, atEnd, found: true };
            }
          }
          return { options: [], noPopup: true };
        }, popupTop, popupLeft);
        
        if (result.noPopup) break;
        
        result.options.forEach(opt => allOptions.add(opt));
        
        if (allOptions.size === previousCount) {
          noChangeCount++;
          if (noChangeCount >= 3 || result.atEnd) break;
        } else {
          noChangeCount = 0;
        }
        previousCount = allOptions.size;
        
        if (!result.scrolled || result.atEnd) break;
        await sleep(50);
      }
      
      const sortedOptions = Array.from(allOptions).sort();
      console.log(`  │   Collected ${sortedOptions.length} unique options`);
      
      // Sanity check: if popup showed many options but we collected few, something went wrong
      if (targetPopup.optionCount >= 5 && sortedOptions.length < 3) {
        console.log(`  │   ⚠️ WARNING: Expected ~${targetPopup.optionCount} options but only got ${sortedOptions.length}`);
        console.log(`  │   Sample collected: ${sortedOptions.slice(0, 3).join(', ')}`);
        console.log(`  │   Expected sample: ${targetPopup.sampleOptions?.join(', ')}`);
      }
      
      if (sortedOptions.length === 0) {
        console.log(`  │   ❌ No options found`);
        await page.keyboard.press('Escape');
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: 'No options found' };
      }
      
      // AI matching
      console.log(`  │`);
      console.log(`  │ STEP 3: AI-driven option matching...`);
      
      const aiResult = await this.findBestOptionWithAI(targetValue, label, sortedOptions, classifier);
      
      if (!aiResult.bestMatch) {
        console.log(`  │   ❌ No good match found`);
        await page.keyboard.press('Escape');
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: 'No matching option' };
      }
      
      console.log(`  │   🤖 AI selected: "${aiResult.bestMatch}" (${(aiResult.confidence * 100).toFixed(0)}%)`);
      
      // ============================================
      // STEP 4: SCROLL TO OPTION AND CLICK (ensure visible in viewport)
      // ============================================
      console.log(`  │`);
      console.log(`  │ STEP 4: Scrolling to and clicking "${aiResult.bestMatch}"...`);
      
      // Scroll popup back to top first
      await page.evaluate((targetTop, targetLeft) => {
        const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
        for (const popup of popups) {
          const rect = popup.getBoundingClientRect();
          if (rect.height > 30 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
            let scrollContainer = popup;
            const isScrollable = (el) => {
              const style = window.getComputedStyle(el);
              return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            };
            if (!isScrollable(popup)) {
              for (const child of popup.querySelectorAll('*')) {
                if (isScrollable(child)) { scrollContainer = child; break; }
              }
            }
            scrollContainer.scrollTop = 0;
            break;
          }
        }
      }, popupTop, popupLeft);
      await sleep(200);
      
      // Scroll until we find the option AND it's visible within the POPUP
      const maxClicks = 50;
      let lastScrollDirection = 'down';
      
      for (let i = 0; i < maxClicks; i++) {
        const clickResult = await page.evaluate((targetText, targetTop, targetLeft) => {
          const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
          for (const popup of popups) {
            const popupRect = popup.getBoundingClientRect();
            if (popupRect.height > 30 && Math.abs(popupRect.top - targetTop) < 50 && Math.abs(popupRect.left - targetLeft) < 50) {
              // Find scrollable container
              let scrollContainer = popup;
              const isScrollable = (el) => {
                const style = window.getComputedStyle(el);
                return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
              };
              if (!isScrollable(popup)) {
                for (const child of popup.querySelectorAll('*')) {
                  if (isScrollable(child)) { scrollContainer = child; break; }
                }
              }
              
              const options = popup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
              
              for (const opt of options) {
                const optRect = opt.getBoundingClientRect();
                const optText = opt.textContent?.trim() || '';
                
                if (optRect.height > 0 && optText === targetText) {
                  // Check if option is visible within POPUP bounds
                  const isVisibleInPopup = optRect.top >= popupRect.top && 
                                           optRect.bottom <= popupRect.bottom + 5;
                  
                  if (isVisibleInPopup) {
                    return {
                      found: true,
                      inPopup: true,
                      x: optRect.left + optRect.width / 2,
                      y: optRect.top + optRect.height / 2,
                      text: optText,
                      optTop: optRect.top,
                      popupTop: popupRect.top,
                      popupBottom: popupRect.bottom
                    };
                  } else {
                    // Option found but not visible - scroll WITHIN popup to bring it into view
                    // Calculate how much to scroll
                    if (optRect.top < popupRect.top) {
                      // Option is above visible area - scroll up
                      scrollContainer.scrollTop -= (popupRect.top - optRect.top + 50);
                    } else {
                      // Option is below visible area - scroll down
                      scrollContainer.scrollTop += (optRect.bottom - popupRect.bottom + 50);
                    }
                    return { found: true, inPopup: false, scrolledWithinPopup: true };
                  }
                }
              }
              
              // Option not found yet, scroll down in popup
              const oldScroll = scrollContainer.scrollTop;
              scrollContainer.scrollTop += 100;
              const atEnd = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 5;
              
              return { found: false, scrolled: scrollContainer.scrollTop > oldScroll, atEnd };
            }
          }
          return { found: false, noPopup: true };
        }, aiResult.bestMatch, popupTop, popupLeft);
        
        if (clickResult.found && clickResult.inPopup) {
          console.log(`  │   ✓ Found VISIBLE in popup at (${clickResult.x.toFixed(0)}, ${clickResult.y.toFixed(0)})`);
          console.log(`  │     Option y=${clickResult.optTop.toFixed(0)}, Popup bounds: ${clickResult.popupTop.toFixed(0)}-${clickResult.popupBottom.toFixed(0)}`);
          console.log(`  │   ACTION: Clicking with Puppeteer...`);
          
          await page.mouse.click(clickResult.x, clickResult.y);
          await sleep(400);
          
          let newBtnText = await btn.evaluate(el => el.textContent || '').catch(() => '');
          console.log(`  │   Button now shows: "${newBtnText.trim()}"`);
          
          if (newBtnText && !newBtnText.toLowerCase().includes('select')) {
            console.log(`  │`);
            console.log(`  │ ✅ SUCCESS - "${newBtnText.trim()}" selected`);
            console.log(`  └─── END DEBUG ───\n`);
            console.log(`  ✅ ${label}: "${aiResult.bestMatch}"`);
            return { success: true, selected: aiResult.bestMatch };
          }
          
          // Puppeteer click didn't work, try JavaScript click
          console.log(`  │   Puppeteer click didn't work, trying JS click...`);
          
          await page.evaluate((text, targetTop, targetLeft) => {
            const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
            for (const popup of popups) {
              const rect = popup.getBoundingClientRect();
              if (rect.height > 30 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
                const options = popup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
                for (const opt of options) {
                  const optText = opt.textContent?.trim();
                  if (optText === text) {
                    opt.click();
                    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    break;
                  }
                }
              }
            }
          }, aiResult.bestMatch, popupTop, popupLeft);
          
          await sleep(400);
          
          newBtnText = await btn.evaluate(el => el.textContent || '').catch(() => '');
          console.log(`  │   After JS click, button shows: "${newBtnText.trim()}"`);
          
          if (newBtnText && !newBtnText.toLowerCase().includes('select')) {
            console.log(`  │`);
            console.log(`  │ ✅ SUCCESS (via JS click) - "${newBtnText.trim()}" selected`);
            console.log(`  └─── END DEBUG ───\n`);
            console.log(`  ✅ ${label}: "${aiResult.bestMatch}"`);
            return { success: true, selected: aiResult.bestMatch };
          }
        }
        
        if (clickResult.scrolledWithinPopup) {
          // Scrolled within popup, retry immediately
          console.log(`  │   Scrolled within popup, retrying...`);
          await sleep(100);
          continue;
        }
        
        if (clickResult.noPopup || clickResult.atEnd || !clickResult.scrolled) {
          break;
        }
        await sleep(50);
      }
      
      console.log(`  │   ⚠️ Could not click option, closing dropdown`);
      await page.keyboard.press('Escape');
      console.log(`  └─── END DEBUG ───\n`);
      return { success: false, error: 'Click did not register' };
      
    } catch (e) {
      await page.keyboard.press('Escape').catch(() => {});
      console.log(`  │ ❌ Error: ${e.message}`);
      console.log(`  └─── END DEBUG ───\n`);
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
      
      // STEP: Scroll element into view first (FIX 2)
      console.log(`  │ ACTION: Scrolling element into view...`);
      await input.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await sleep(100);
      
      // STEP: Click to focus
      console.log(`  │ ACTION: Click to focus...`);
      await input.click();
      await sleep(300);
      
      // FIX 2: Verify focus - if wrong element focused, use JavaScript to force focus
      const focusedAfterClick = await page.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName, id: el?.id, type: el?.type };
      });
      console.log(`  │   → Focused: <${focusedAfterClick.tag?.toLowerCase()}> id="${focusedAfterClick.id}"`);
      
      // Check if the correct element is focused
      if (focusedAfterClick.id !== inputInfo.id && inputInfo.id) {
        console.log(`  │   ⚠️ Wrong element focused! Expected "${inputInfo.id}", got "${focusedAfterClick.id}"`);
        console.log(`  │   ACTION: Attempting JavaScript focus...`);
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.focus();
            el.click();
          }
        }, selector);
        await sleep(200);
        
        // Verify again
        const focusedRetry = await page.evaluate(() => {
          const el = document.activeElement;
          return { tag: el?.tagName, id: el?.id };
        });
        console.log(`  │   → After JS focus: <${focusedRetry.tag?.toLowerCase()}> id="${focusedRetry.id}"`);
        
        if (focusedRetry.id !== inputInfo.id && inputInfo.id) {
          console.log(`  │   ❌ Still cannot focus the correct element!`);
          console.log(`  └─── END DEBUG ───\n`);
          return { success: false, error: 'Cannot focus input element' };
        }
      };
      
      // ============================================
      // DETECT FIELD TYPE AND USE APPROPRIATE STRATEGY
      // ============================================
      const labelLower = label.toLowerCase();
      const isSchoolField = labelLower.includes('school') || labelLower.includes('university') || 
                            inputInfo.id?.toLowerCase().includes('school');
      const isFieldOfStudyField = labelLower.includes('field of study') || labelLower.includes('major') ||
                                   inputInfo.id?.toLowerCase().includes('fieldofstudy');
      
      console.log(`  │`);
      console.log(`  │ FIELD TYPE DETECTION:`);
      console.log(`  │   Is School/University field: ${isSchoolField}`);
      console.log(`  │   Is Field of Study field: ${isFieldOfStudyField}`);
      
      // ============================================
      // SCHOOL/UNIVERSITY FIELD - Type + Enter (no dropdown)
      // Workday designed this field to NOT have a dropdown
      // ============================================
      if (isSchoolField) {
        console.log(`  │`);
        console.log(`  │ 🎓 SCHOOL FIELD DETECTED - Using type + Enter strategy`);
        console.log(`  │ ACTION: Clearing existing text (Ctrl+A)...`);
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await sleep(50);
        
        console.log(`  │ ACTION: Typing full value "${value}"...`);
        await page.keyboard.type(value, { delay: 30 });
        await sleep(500);
        
        console.log(`  │ ACTION: Pressing Enter to confirm...`);
        await page.keyboard.press('Enter');
        await sleep(500);
        
        // Verify the field has been filled
        const finalValue = await input.evaluate(el => el.value);
        const pillCheck = await input.evaluate(el => {
          const container = el.closest('[data-automation-id*="formField"]') || 
                            el.parentElement?.parentElement?.parentElement;
          const pill = container?.querySelector('[data-automation-id="selectedItem"]');
          return { found: !!pill, text: pill?.textContent?.trim() };
        });
        
        console.log(`  │`);
        console.log(`  │ VERIFICATION:`);
        console.log(`  │   Input value: "${finalValue}"`);
        console.log(`  │   Pill found: ${pillCheck.found} ${pillCheck.text ? `("${pillCheck.text}")` : ''}`);
        
        if (pillCheck.found || (finalValue && finalValue.toLowerCase().includes(value.toLowerCase().substring(0, 10)))) {
          console.log(`  │`);
          console.log(`  │ ✅ SUCCESS - School field filled`);
          console.log(`  └─── END DEBUG ───\n`);
          console.log(`  ✅ ${label}: "${pillCheck.text || finalValue}"`);
          return { success: true, selected: pillCheck.text || finalValue };
        } else {
          console.log(`  │`);
          console.log(`  │ ❌ FAILED - School field not confirmed`);
          console.log(`  └─── END DEBUG ───\n`);
          return { success: false, error: 'School not confirmed after Enter' };
        }
      }
      
      // ============================================
      // FIELD OF STUDY - Scroll to load ALL options, then AI match
      // Workday designed this field to NOT filter - must scroll through all
      // ============================================
      if (isFieldOfStudyField) {
        console.log(`  │`);
        console.log(`  │ 📚 FIELD OF STUDY DETECTED - Using scroll-to-load-all strategy`);
        
        // CRITICAL: Close ALL existing popups first to ensure clean state
        console.log(`  │ ACTION: Closing any existing popups...`);
        await page.keyboard.press('Escape');
        await sleep(200);
        await page.keyboard.press('Escape');
        await sleep(200);
        
        // Now click to open ONLY this dropdown
        console.log(`  │ ACTION: Clicking to open dropdown...`);
        await input.click();
        await sleep(1000); // Wait longer for dropdown to fully render
        
        // Get the input's position to help identify the correct popup
        const inputRect = await input.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, left: rect.left, bottom: rect.bottom };
        });
        console.log(`  │   Input position: top=${inputRect.top.toFixed(0)}, left=${inputRect.left.toFixed(0)}`);
        
        // Scroll through ALL options
        console.log(`  │ ACTION: Scrolling to load ALL options...`);
        
        const allOptions = await WorkdayPlatform.scrollAndCollectAllOptions(page, inputRect);
        
        console.log(`  │   Total options loaded: ${allOptions.length}`);
        if (allOptions.length > 0) {
          console.log(`  │   First 3: ${allOptions.slice(0, 3).join(', ')}`);
          console.log(`  │   Last 3: ${allOptions.slice(-3).join(', ')}`);
        }
        
        if (allOptions.length === 0) {
          console.log(`  │   ❌ No options found in dropdown`);
          console.log(`  └─── END DEBUG ───\n`);
          return { success: false, error: 'No dropdown options' };
        }
        
        // Now use AI to find best match (same strategy as "How did you hear about us")
        console.log(`  │`);
        console.log(`  │ AI-DRIVEN OPTION SELECTION (same as "How did you hear about us")...`);
        
        // First try exact match
        const exactMatch = allOptions.find(opt => 
          opt.toLowerCase() === value.toLowerCase() ||
          opt.toLowerCase().includes(value.toLowerCase()) ||
          value.toLowerCase().includes(opt.toLowerCase())
        );
        
        let selectedOption = null;
        
        if (exactMatch) {
          console.log(`  │   ✓ Exact match found: "${exactMatch}"`);
          selectedOption = exactMatch;
        } else {
          // Use AI semantic matching
          console.log(`  │   No exact match. Using AI semantic matching...`);
          const aiResult = await WorkdayPlatform.findBestOptionWithAI(value, label, allOptions, classifier);
          if (aiResult.bestMatch) {
            console.log(`  │   🤖 AI selected: "${aiResult.bestMatch}" (${(aiResult.confidence * 100).toFixed(1)}%)`);
            selectedOption = aiResult.bestMatch;
          }
        }
        
        if (!selectedOption) {
          console.log(`  │   ❌ No matching option found for "${value}"`);
          console.log(`  └─── END DEBUG ───\n`);
          return { success: false, error: 'No matching option' };
        }
        
        // Scroll to and click the selected option
        console.log(`  │ ACTION: Scrolling to and clicking "${selectedOption}"...`);
        
        const clickResult = await WorkdayPlatform.scrollToAndClickOption(page, selectedOption);
        
        if (clickResult.success) {
          await sleep(500);
          
          // Verify pill appeared with CORRECT text
          const pillCheck = await input.evaluate(el => {
            const container = el.closest('[data-automation-id*="formField"]');
            const pill = container?.querySelector('[data-automation-id="selectedItem"]');
            return { found: !!pill, text: pill?.textContent?.trim() };
          });
          
          if (pillCheck.found) {
            // IMPORTANT: Verify the pill text matches what we wanted!
            if (pillCheck.text === selectedOption) {
              console.log(`  │`);
              console.log(`  │ ✅ SUCCESS - "${pillCheck.text}" selected (exact match)`);
              console.log(`  └─── END DEBUG ───\n`);
              console.log(`  ✅ ${label}: "${pillCheck.text}"`);
              return { success: true, selected: pillCheck.text };
            } else {
              // Wrong option was selected! This shouldn't happen with mouse click
              console.log(`  │   ⚠️ WARNING: Pill shows "${pillCheck.text}" but we wanted "${selectedOption}"`);
              console.log(`  │   Attempting to clear and retry...`);
              
              // Try to clear the wrong selection and retry
              const clearBtn = await page.$('[data-automation-id="selectedItem"] [data-automation-id="DELETE_charm"]');
              if (clearBtn) {
                await clearBtn.click();
                await sleep(300);
                // Retry the click
                const retryResult = await WorkdayPlatform.scrollToAndClickOption(page, selectedOption);
                if (retryResult.success) {
                  await sleep(500);
                  const retryPill = await input.evaluate(el => {
                    const container = el.closest('[data-automation-id*="formField"]');
                    const pill = container?.querySelector('[data-automation-id="selectedItem"]');
                    return { found: !!pill, text: pill?.textContent?.trim() };
                  });
                  if (retryPill.found && retryPill.text === selectedOption) {
                    console.log(`  │   ✅ Retry succeeded! "${retryPill.text}" selected`);
                    console.log(`  └─── END DEBUG ───\n`);
                    return { success: true, selected: retryPill.text };
                  }
                }
              }
              
              // Accept what we got if close enough
              console.log(`  │   Accepting "${pillCheck.text}" as close enough`);
              console.log(`  └─── END DEBUG ───\n`);
              console.log(`  ✅ ${label}: "${pillCheck.text}"`);
              return { success: true, selected: pillCheck.text };
            }
          } else {
            console.log(`  │   Pill not found after Puppeteer click.`);
            
            // Check if input has value even without pill
            const inputVal = await input.evaluate(el => el.value);
            if (inputVal && inputVal.toLowerCase().includes(selectedOption.toLowerCase().split(' ')[0])) {
              console.log(`  │`);
              console.log(`  │ ✅ SUCCESS - "${inputVal}" in input (no pill)`);
              console.log(`  └─── END DEBUG ───\n`);
              console.log(`  ✅ ${label}: "${inputVal}"`);
              return { success: true, selected: inputVal };
            }
            
            console.log(`  │   ❌ Click did not produce a selection`);
          }
        }
        
        console.log(`  │   ❌ Failed to select option: ${clickResult.error || 'unknown'}`);
        console.log(`  └─── END DEBUG ───\n`);
        return { success: false, error: clickResult.error || 'Failed to click option' };
      }
      
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
      
      // CRITICAL FIX: Get input position for position-based popup detection
      const inputRect = await input.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, left: rect.left, bottom: rect.bottom };
      });
      
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
        
        // CRITICAL FIX: Collect options ONLY from the popup closest to this input
        const visibleOptions = await page.evaluate((inputTop, inputLeft) => {
          // First, find the popup closest to our input using position
          const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"], [data-automation-id*="dropdown"]');
          let targetPopup = null;
          let minDistance = Infinity;
          
          for (const popup of popups) {
            const rect = popup.getBoundingClientRect();
            if (rect.height > 30 && rect.width > 50) {
              // Calculate distance from input to popup
              const dist = Math.abs(rect.top - inputTop) + Math.abs(rect.left - inputLeft);
              // Popup should be below or very close to input (within 100px vertically)
              if (Math.abs(rect.top - inputTop) < 150 && dist < minDistance) {
                // Additional check: skip if it looks like a phone code popup
                const firstOption = popup.querySelector('[data-automation-id="promptOption"], [role="option"]');
                const firstText = firstOption?.textContent || '';
                if (!firstText.includes('(+')) {
                  minDistance = dist;
                  targetPopup = popup;
                }
              }
            }
          }
          
          if (!targetPopup) {
            // Fallback: find any visible popup that doesn't have phone codes
            for (const popup of popups) {
              const rect = popup.getBoundingClientRect();
              if (rect.height > 30) {
                const firstOption = popup.querySelector('[data-automation-id="promptOption"], [role="option"]');
                const firstText = firstOption?.textContent || '';
                if (!firstText.includes('(+')) {
                  targetPopup = popup;
                  break;
                }
              }
            }
          }
          
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
          
          // Search within target popup only, or fall back to document
          const searchRoot = targetPopup || document;
          
          for (const sel of optionSelectors) {
            const elements = searchRoot.querySelectorAll(sel);
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
        }, inputRect.top, inputRect.left);
        
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
        // CRITICAL: Close any open popups before returning failure
        await page.keyboard.press('Escape');
        await sleep(100);
        
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
      // CRITICAL: Close any open popups first (they can intercept clicks!)
      await page.keyboard.press('Escape');
      await sleep(100);
      
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
  // HELPER: Scroll through dropdown to load ALL options
  // Workday lazy-loads options, showing only ~22 at a time
  // ============================================
  async scrollAndCollectAllOptions(page, inputRect = null) {
    console.log(`  │   Starting scroll collection...`);
    
    // Wait for dropdown to fully render
    await sleep(500);
    
    // Find the CORRECT popup - the one that's VISIBLE and near our input
    const popupInfo = await page.evaluate((inputPos) => {
      const popupSelectors = ['[data-automation-id="selectBoxPopup"]', '[role="listbox"]'];
      const foundPopups = [];
      
      for (const sel of popupSelectors) {
        const candidates = document.querySelectorAll(sel);
        for (let idx = 0; idx < candidates.length; idx++) {
          const el = candidates[idx];
          const rect = el.getBoundingClientRect();
          
          // Check visibility: has height, on screen, and visible
          const style = window.getComputedStyle(el);
          const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden';
          const isOnScreen = rect.height > 50 && rect.top >= 0 && rect.left >= 0;
          
          if (isDisplayed && isOnScreen) {
            // Calculate distance from input (if provided)
            let distanceFromInput = 0;
            if (inputPos) {
              // Popup should be below or near the input
              distanceFromInput = Math.abs(rect.top - inputPos.bottom) + Math.abs(rect.left - inputPos.left);
            }
            
            const options = el.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
            const visibleOpts = Array.from(options).filter(o => {
              const oRect = o.getBoundingClientRect();
              return oRect.height > 0 && oRect.top >= rect.top && oRect.bottom <= rect.bottom + 10;
            });
            
            foundPopups.push({
              index: idx,
              selector: sel,
              rect: { top: rect.top, left: rect.left, height: rect.height, width: rect.width },
              distanceFromInput,
              optionCount: visibleOpts.length,
              firstOption: visibleOpts[0]?.textContent?.trim().substring(0, 40) || '(none)',
              lastOption: visibleOpts[visibleOpts.length - 1]?.textContent?.trim().substring(0, 40) || '(none)',
              allOptionTexts: visibleOpts.map(o => o.textContent?.trim()).slice(0, 5)
            });
          }
        }
      }
      
      // Sort by distance from input (closest first)
      foundPopups.sort((a, b) => a.distanceFromInput - b.distanceFromInput);
      
      return { popups: foundPopups };
    }, inputRect);
    
    console.log(`  │   Found ${popupInfo.popups.length} VISIBLE popup(s)`);
    for (const p of popupInfo.popups) {
      console.log(`  │     - [${p.index}] pos=(${p.rect.top.toFixed(0)},${p.rect.left.toFixed(0)}) ${p.optionCount} opts: "${p.firstOption}" ... "${p.lastOption}"`);
      console.log(`  │       Distance from input: ${p.distanceFromInput.toFixed(0)}px`);
      console.log(`  │       Sample: ${p.allOptionTexts.slice(0, 3).join(', ')}`);
    }
    
    if (popupInfo.popups.length === 0) {
      console.log(`  │   ERROR: No visible dropdown popup found!`);
      return [];
    }
    
    // Use the closest popup to the input
    const targetPopup = popupInfo.popups[0];
    console.log(`  │   Using popup at (${targetPopup.rect.top.toFixed(0)}, ${targetPopup.rect.left.toFixed(0)}) with ${targetPopup.optionCount} options`);
    
    // Store the popup's position to identify it later
    const popupTop = targetPopup.rect.top;
    const popupLeft = targetPopup.rect.left;
    
    // Collect ALL options by scrolling
    const allOptions = new Set();
    let previousCount = 0;
    let noChangeCount = 0;
    const maxIterations = 500;
    
    // Click on the first visible option to ensure focus is in the dropdown
    await page.evaluate((top, left) => {
      const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
      for (const popup of popups) {
        const rect = popup.getBoundingClientRect();
        // Find popup by position
        if (Math.abs(rect.top - top) < 5 && Math.abs(rect.left - left) < 5) {
          const firstOpt = popup.querySelector('[data-automation-id="promptOption"], [role="option"]');
          if (firstOpt) {
            firstOpt.scrollIntoView({ block: 'start' });
          }
          break;
        }
      }
    }, popupTop, popupLeft);
    await sleep(200);
    
    // Press ArrowDown to start navigation
    await page.keyboard.press('ArrowDown');
    await sleep(100);
    
    for (let i = 0; i < maxIterations; i++) {
      // Collect options from the CORRECT popup (identified by position)
      const result = await page.evaluate((targetTop, targetLeft) => {
        // Find the popup by its position
        const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
        let targetPopup = null;
        
        for (const popup of popups) {
          const rect = popup.getBoundingClientRect();
          // Match by position (with small tolerance)
          if (rect.height > 50 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
            targetPopup = popup;
            break;
          }
        }
        
        if (!targetPopup) {
          // Fallback: find any visible popup
          for (const popup of popups) {
            const rect = popup.getBoundingClientRect();
            if (rect.height > 50 && rect.top >= 0) {
              targetPopup = popup;
              break;
            }
          }
        }
        
        if (!targetPopup) {
          return { options: [], error: 'popup not found' };
        }
        
        // Get visible options from this specific popup
        const popupRect = targetPopup.getBoundingClientRect();
        const optElements = targetPopup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
        const options = [];
        
        for (const el of optElements) {
          const rect = el.getBoundingClientRect();
          // Must be visible and within the popup's bounds
          if (rect.height > 0 && rect.top >= popupRect.top - 5 && rect.bottom <= popupRect.bottom + 5) {
            const text = el.textContent?.trim() || '';
            if (text.length >= 2 && text.length < 100 && text !== 'No Items.') {
              options.push(text);
            }
          }
        }
        
        return { options, count: options.length };
      }, popupTop, popupLeft);
      
      if (result.error) {
        console.log(`  │   ERROR: ${result.error}`);
        break;
      }
      
      // Add new options
      const sizeBefore = allOptions.size;
      result.options.forEach(opt => allOptions.add(opt));
      const newCount = allOptions.size - sizeBefore;
      
      // Log progress
      if (i % 50 === 0 || (newCount > 0 && i % 20 === 0)) {
        console.log(`  │   Iteration ${i + 1}: ${allOptions.size} total (+${newCount} new, visible: ${result.count})`);
      }
      
      // Check progress
      if (allOptions.size === previousCount) {
        noChangeCount++;
        if (noChangeCount >= 30) {
          console.log(`  │   No new options after 30 iterations. Total: ${allOptions.size}`);
          break;
        }
      } else {
        noChangeCount = 0;
      }
      previousCount = allOptions.size;
      
      // Navigate down
      await page.keyboard.press('ArrowDown');
      await sleep(20);
    }
    
    const sortedOptions = Array.from(allOptions).sort();
    console.log(`  │   Collection complete: ${sortedOptions.length} unique options`);
    
    if (sortedOptions.length > 0) {
      console.log(`  │   Sample: ${sortedOptions.slice(0, 3).join(', ')} ... ${sortedOptions.slice(-3).join(', ')}`);
    }
    
    return sortedOptions;
  },

  // ============================================
  // HELPER: Scroll to specific option and click it
  // Uses real Puppeteer click, not JavaScript click
  // ============================================
  async scrollToAndClickOption(page, targetText) {
    console.log(`  │   Looking for option: "${targetText}"`);
    
    // First, find the VISIBLE popup and scroll it to top
    const popupInfo = await page.evaluate(() => {
      const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
      for (const popup of popups) {
        const rect = popup.getBoundingClientRect();
        if (rect.height > 50 && rect.top >= 0) {
          // Find and reset scrollable container
          let scrollContainer = popup;
          const isScrollable = (el) => {
            const style = window.getComputedStyle(el);
            return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
          };
          
          if (!isScrollable(popup)) {
            for (const child of popup.querySelectorAll('*')) {
              if (isScrollable(child)) {
                scrollContainer = child;
                break;
              }
            }
          }
          scrollContainer.scrollTop = 0;
          
          return { found: true, top: rect.top, left: rect.left };
        }
      }
      return { found: false };
    });
    
    if (!popupInfo.found) {
      console.log(`  │   ERROR: No visible popup found`);
      return { success: false, error: 'no visible popup' };
    }
    
    await sleep(200);
    
    // Scroll through dropdown using scrollTop (NOT ArrowDown) to find the option
    // This way we don't move the keyboard highlight
    const maxScrollAttempts = 200;
    
    for (let scrollAttempt = 0; scrollAttempt < maxScrollAttempts; scrollAttempt++) {
      // Check if target option is visible and get its coordinates
      const result = await page.evaluate((text, targetTop, targetLeft) => {
        const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
        for (const popup of popups) {
          const rect = popup.getBoundingClientRect();
          if (rect.height > 50 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
            const options = popup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
            
            for (const opt of options) {
              const optRect = opt.getBoundingClientRect();
              const optText = opt.textContent?.trim();
              
              // Must be visible (within viewport) and match text
              if (optRect.height > 0 && 
                  optRect.top >= rect.top && 
                  optRect.bottom <= rect.bottom + 5 &&
                  optText === text) {
                // Found it! Return coordinates for Puppeteer click
                return { 
                  found: true,
                  x: optRect.left + optRect.width / 2,
                  y: optRect.top + optRect.height / 2,
                  text: optText
                };
              }
            }
            
            // Option not visible yet, scroll the container
            let scrollContainer = popup;
            const isScrollable = (el) => {
              const style = window.getComputedStyle(el);
              return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            };
            
            if (!isScrollable(popup)) {
              for (const child of popup.querySelectorAll('*')) {
                if (isScrollable(child)) {
                  scrollContainer = child;
                  break;
                }
              }
            }
            
            const oldScroll = scrollContainer.scrollTop;
            scrollContainer.scrollTop += 200;
            const scrolled = scrollContainer.scrollTop > oldScroll;
            const atEnd = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 5;
            
            return { found: false, scrolled, atEnd };
          }
        }
        return { found: false, error: 'popup lost' };
      }, targetText, popupInfo.top, popupInfo.left);
      
      if (result.found) {
        console.log(`  │   ✓ Found "${result.text}" at (${result.x.toFixed(0)}, ${result.y.toFixed(0)})`);
        
        // Use Puppeteer's REAL mouse click at exact coordinates
        console.log(`  │   ACTION: Clicking at coordinates with Puppeteer...`);
        await page.mouse.click(result.x, result.y);
        await sleep(300);
        
        // Check if pill appeared
        const pillAfterClick = await page.evaluate(() => {
          const pill = document.querySelector('[data-automation-id="selectedItem"]');
          return pill ? pill.textContent?.trim() : null;
        });
        
        if (pillAfterClick) {
          console.log(`  │   ✅ Pill appeared: "${pillAfterClick}"`);
          return { success: true, clickedText: result.text };
        }
        
        // Puppeteer click didn't work, try JavaScript click
        console.log(`  │   Puppeteer click didn't create pill, trying JS click...`);
        
        const jsClickResult = await page.evaluate((text, targetTop, targetLeft) => {
          const popups = document.querySelectorAll('[role="listbox"], [data-automation-id="selectBoxPopup"]');
          for (const popup of popups) {
            const rect = popup.getBoundingClientRect();
            if (rect.height > 50 && Math.abs(rect.top - targetTop) < 50 && Math.abs(rect.left - targetLeft) < 50) {
              const options = popup.querySelectorAll('[data-automation-id="promptOption"], [role="option"]');
              for (const opt of options) {
                const optRect = opt.getBoundingClientRect();
                const optText = opt.textContent?.trim();
                if (optRect.height > 0 && optText === text) {
                  // Try multiple click methods
                  opt.click();
                  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                  opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  return { clicked: true };
                }
              }
            }
          }
          return { clicked: false };
        }, targetText, popupInfo.top, popupInfo.left);
        
        await sleep(400);
        
        // Final pill check
        const finalPill = await page.evaluate(() => {
          const pill = document.querySelector('[data-automation-id="selectedItem"]');
          return pill ? pill.textContent?.trim() : null;
        });
        
        if (finalPill) {
          console.log(`  │   ✅ JS click worked! Pill: "${finalPill}"`);
          return { success: true, clickedText: result.text };
        }
        
        console.log(`  │   ❌ Click did not produce a selection`);
        return { success: false, error: 'click failed' };
      }
      
      if (result.error) {
        console.log(`  │   ERROR: ${result.error}`);
        return { success: false, error: result.error };
      }
      
      if (result.atEnd) {
        console.log(`  │   Reached end of dropdown, option not found`);
        break;
      }
      
      if (!result.scrolled) {
        console.log(`  │   Cannot scroll further`);
        break;
      }
      
      // Small delay for lazy-loading
      await sleep(50);
    }
    
    console.log(`  │   ❌ Could not find option "${targetText}" after scrolling`);
    return { success: false, error: 'Option not found' };
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
      const SemanticSimilarityModule = await import('../semantic-similarity.js');
      const SemanticSimilarityClass = SemanticSimilarityModule.default;
      
      // Create an instance of the classifier
      const semanticClassifier = new SemanticSimilarityClass();
      
      // Load the model if not already loaded
      if (!semanticClassifier.isLoaded) {
        await semanticClassifier.loadModel();
      }
      
      // Get embedding for our target value (what we're looking for)
      const targetEmbedding = await semanticClassifier.getEmbedding(targetValue);
      
      // Score each option by semantic similarity
      const scoredOptions = [];
      
      // Limit to first 100 options for performance (Field of Study can have 500+)
      const optionsToScore = options.slice(0, 100);
      console.log(`  │     Scoring ${optionsToScore.length} options (of ${options.length} total)...`);
      
      for (const option of optionsToScore) {
        const optionEmbedding = await semanticClassifier.getEmbedding(option);
        const similarity = semanticClassifier.cosineSimilarity(targetEmbedding, optionEmbedding);
        scoredOptions.push({ option, score: similarity });
      }
      
      // Sort by similarity (highest first)
      scoredOptions.sort((a, b) => b.score - a.score);
      
      console.log(`  │     Semantic similarity scores (top 5):`);
      for (const scored of scoredOptions.slice(0, 5)) {
        console.log(`  │       ${(scored.score * 100).toFixed(1)}% - "${scored.option.substring(0, 40)}"`);
      }
      
      // Return best match if similarity is reasonable (0.5+ is a decent match)
      if (scoredOptions.length > 0 && scoredOptions[0].score > 0.5) {
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
   * Scores ALL options and returns the BEST match (not the first match!)
   */
  findBestOptionByKeywords(targetValue, fieldLabel, options) {
    const targetLower = targetValue.toLowerCase().trim();
    const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
    
    console.log(`  │     Scoring all ${options.length} options to find best match...`);
    
    // Score EVERY option
    const scoredOptions = options.map(option => {
      const optionLower = option.toLowerCase();
      let score = 0;
      let matchType = '';
      
      // ========================================
      // TIER 1: EXACT MATCH (highest priority)
      // ========================================
      if (optionLower === targetLower) {
        score = 100;
        matchType = 'exact';
        return { option, score, matchType };
      }
      
      // ========================================
      // TIER 2: TARGET CONTAINED IN OPTION or vice versa
      // "Electrical Engineering" in "Electrical and Computer Engineering" = 90 points
      // ========================================
      if (optionLower.includes(targetLower)) {
        score = 90;
        matchType = 'target-in-option';
        return { option, score, matchType };
      }
      if (targetLower.includes(optionLower) && optionLower.length > 5) {
        score = 85;
        matchType = 'option-in-target';
        return { option, score, matchType };
      }
      
      // ========================================
      // TIER 3: ALL WORDS MATCH
      // All words from target appear in option
      // ========================================
      const allWordsMatch = targetWords.every(word => optionLower.includes(word));
      if (allWordsMatch && targetWords.length >= 2) {
        score = 80;
        matchType = 'all-words';
        return { option, score, matchType };
      }
      
      // ========================================
      // TIER 4: PARTIAL WORD MATCH (with word count bonus)
      // ========================================
      let wordMatchCount = 0;
      for (const word of targetWords) {
        if (optionLower.includes(word)) {
          wordMatchCount++;
          score += 15; // Each matching word adds 15 points
        }
      }
      
      // Bonus for matching more words
      if (wordMatchCount === targetWords.length) {
        score += 20;
      } else if (wordMatchCount >= targetWords.length * 0.5) {
        score += 10;
      }
      
      // ========================================
      // TIER 5: STRING SIMILARITY (Levenshtein-like)
      // ========================================
      // Check how many characters match at the start
      let prefixMatch = 0;
      for (let i = 0; i < Math.min(targetLower.length, optionLower.length); i++) {
        if (targetLower[i] === optionLower[i]) prefixMatch++;
        else break;
      }
      if (prefixMatch >= 5) {
        score += prefixMatch; // Add points for matching prefix
      }
      
      if (wordMatchCount > 0) {
        matchType = `${wordMatchCount}-words`;
      }
      
      return { option, score, matchType };
    });
    
    // Sort by score (highest first)
    scoredOptions.sort((a, b) => b.score - a.score);
    
    // Log top 5 matches
    console.log(`  │     Top 5 matches:`);
    for (const match of scoredOptions.slice(0, 5)) {
      if (match.score > 0) {
        console.log(`  │       ${match.score} pts (${match.matchType || 'partial'}): "${match.option}"`);
      }
    }
    
    // Return best match if score is reasonable
    const best = scoredOptions[0];
    if (best && best.score >= 15) {
      // Convert score to confidence (0-1 range)
      const confidence = Math.min(best.score / 100, 0.99);
      return { bestMatch: best.option, confidence, matchType: best.matchType };
    }
    
    return { bestMatch: null, confidence: 0 };
  }
};

export default WorkdayPlatform;
