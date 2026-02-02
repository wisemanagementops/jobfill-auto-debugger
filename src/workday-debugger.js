// ============================================
// WORKDAY FILL DEBUGGER
// Captures exactly what happens when we try to fill fields
// Goal: Find the fundamental gap that works across ALL Workday forms
// ============================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const WorkdayDebugger = {
  
  // ============================================
  // MAIN DEBUG FUNCTION
  // Call this instead of regular fill to see what's happening
  // ============================================
  async debugFillText(page, selector, value, label) {
    console.log('\n' + '='.repeat(60));
    console.log(`🔬 DEBUG: Filling "${label}" with "${value}"`);
    console.log('='.repeat(60));
    
    // ========== STEP 1: FIND THE ELEMENT ==========
    console.log('\n📍 STEP 1: Finding element...');
    console.log(`   Selector: ${selector}`);
    
    const element = await page.$(selector);
    
    if (!element) {
      console.log('   ❌ Element NOT FOUND');
      return { success: false, error: 'Element not found' };
    }
    
    console.log('   ✅ Element found');
    
    // ========== STEP 2: ANALYZE THE ELEMENT ==========
    console.log('\n📍 STEP 2: Analyzing element properties...');
    
    const elementInfo = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      
      // Get computed styles
      const styles = window.getComputedStyle(el);
      
      // Get all attributes
      const attrs = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }
      
      // Check parent chain (up to 5 levels)
      const parents = [];
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 5) {
        parents.push({
          tag: parent.tagName,
          id: parent.id,
          classes: parent.className,
          dataAutomationId: parent.getAttribute('data-automation-id')
        });
        parent = parent.parentElement;
        depth++;
      }
      
      // Check for nearby/related elements
      const container = el.closest('[data-automation-id]');
      
      return {
        // Basic info
        tagName: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        className: el.className,
        
        // Attributes
        attributes: attrs,
        
        // State
        value: el.value,
        textContent: el.textContent?.substring(0, 100),
        innerHTML: el.innerHTML?.substring(0, 200),
        
        // Visibility
        isVisible: styles.display !== 'none' && styles.visibility !== 'hidden',
        width: el.offsetWidth,
        height: el.offsetHeight,
        
        // Editability
        isContentEditable: el.isContentEditable,
        contentEditable: el.contentEditable,
        readOnly: el.readOnly,
        disabled: el.disabled,
        
        // Focus
        isFocused: document.activeElement === el,
        tabIndex: el.tabIndex,
        
        // Parent chain
        parents: parents,
        
        // Container
        containerAutomationId: container?.getAttribute('data-automation-id'),
        
        // Bounding box
        rect: el.getBoundingClientRect()
      };
    }, selector);
    
    console.log('   Element details:');
    console.log(`   - Tag: <${elementInfo.tagName.toLowerCase()}>`);
    console.log(`   - ID: ${elementInfo.id || '(none)'}`);
    console.log(`   - Type: ${elementInfo.type || '(none)'}`);
    console.log(`   - Classes: ${elementInfo.className || '(none)'}`);
    console.log(`   - Current value: "${elementInfo.value || ''}"`);
    console.log(`   - Size: ${elementInfo.width}x${elementInfo.height}px`);
    console.log(`   - Visible: ${elementInfo.isVisible}`);
    console.log(`   - ContentEditable: ${elementInfo.isContentEditable}`);
    console.log(`   - ReadOnly: ${elementInfo.readOnly}`);
    console.log(`   - Disabled: ${elementInfo.disabled}`);
    console.log(`   - Container: ${elementInfo.containerAutomationId || '(none)'}`);
    
    console.log('\n   Key attributes:');
    const importantAttrs = ['data-automation-id', 'aria-label', 'aria-describedby', 'role', 'placeholder'];
    for (const attr of importantAttrs) {
      if (elementInfo.attributes[attr]) {
        console.log(`   - ${attr}: ${elementInfo.attributes[attr]}`);
      }
    }
    
    console.log('\n   Parent chain:');
    for (let i = 0; i < elementInfo.parents.length; i++) {
      const p = elementInfo.parents[i];
      console.log(`   ${i + 1}. <${p.tag.toLowerCase()}> id="${p.id || ''}" data-automation-id="${p.dataAutomationId || ''}"`);
    }
    
    // ========== STEP 3: CHECK FOR ALTERNATIVE ELEMENTS ==========
    console.log('\n📍 STEP 3: Looking for alternative fillable elements...');
    
    const alternatives = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return [];
      
      // Find the container
      const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement?.parentElement;
      if (!container) return [];
      
      // Look for all potentially fillable elements in container
      const candidates = container.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]');
      
      return Array.from(candidates).map(c => ({
        tag: c.tagName,
        type: c.type,
        id: c.id,
        name: c.name,
        dataAutomationId: c.getAttribute('data-automation-id'),
        isContentEditable: c.isContentEditable,
        role: c.getAttribute('role'),
        value: c.value || c.textContent?.substring(0, 50),
        width: c.offsetWidth,
        height: c.offsetHeight,
        isHidden: c.type === 'hidden' || c.offsetWidth === 0
      }));
    }, selector);
    
    if (alternatives.length > 0) {
      console.log(`   Found ${alternatives.length} potential fillable element(s):`);
      for (const alt of alternatives) {
        const hidden = alt.isHidden ? ' [HIDDEN]' : '';
        console.log(`   - <${alt.tag.toLowerCase()} type="${alt.type || ''}" id="${alt.id || ''}">${hidden}`);
        console.log(`     role="${alt.role || ''}" contenteditable="${alt.isContentEditable}"`);
        console.log(`     current value: "${alt.value || ''}"`);
      }
    } else {
      console.log('   No alternative elements found');
    }
    
    // ========== STEP 4: TRY TO FILL ==========
    console.log('\n📍 STEP 4: Attempting to fill...');
    
    // 4a. Click to focus
    console.log('   4a. Clicking to focus...');
    await element.click();
    await sleep(200);
    
    const afterClick = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return {
        isFocused: document.activeElement === el,
        activeElementTag: document.activeElement?.tagName,
        activeElementId: document.activeElement?.id,
        activeElementType: document.activeElement?.type
      };
    }, selector);
    
    console.log(`   - Element focused: ${afterClick.isFocused}`);
    console.log(`   - Active element: <${afterClick.activeElementTag?.toLowerCase()}> id="${afterClick.activeElementId || ''}"`);
    
    // 4b. Select all existing text
    console.log('   4b. Selecting all text (Ctrl+A)...');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await sleep(100);
    
    // 4c. Type the value
    console.log(`   4c. Typing "${value}"...`);
    await page.keyboard.type(String(value), { delay: 30 });
    await sleep(300);
    
    // 4d. Check what happened
    console.log('   4d. Checking result...');
    
    const afterType = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      
      // Check the element itself
      const result = {
        elementValue: el.value,
        elementTextContent: el.textContent?.substring(0, 100),
        elementInnerHTML: el.innerHTML?.substring(0, 200)
      };
      
      // Check for any input in the container
      const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement?.parentElement;
      if (container) {
        const inputs = container.querySelectorAll('input');
        result.containerInputs = Array.from(inputs).map(i => ({
          type: i.type,
          id: i.id,
          name: i.name,
          value: i.value
        }));
        
        // Check for contenteditable
        const editables = container.querySelectorAll('[contenteditable="true"]');
        result.contentEditables = Array.from(editables).map(e => ({
          textContent: e.textContent?.substring(0, 100)
        }));
      }
      
      return result;
    }, selector);
    
    console.log('\n   Result after typing:');
    console.log(`   - element.value: "${afterType.elementValue || ''}"`);
    console.log(`   - element.textContent: "${afterType.elementTextContent || ''}"`);
    
    if (afterType.containerInputs?.length > 0) {
      console.log('   - Container inputs:');
      for (const inp of afterType.containerInputs) {
        console.log(`     <input type="${inp.type}" id="${inp.id}"> value="${inp.value}"`);
      }
    }
    
    if (afterType.contentEditables?.length > 0) {
      console.log('   - ContentEditable elements:');
      for (const ce of afterType.contentEditables) {
        console.log(`     textContent: "${ce.textContent}"`);
      }
    }
    
    // 4e. Press Tab to trigger blur/validation
    console.log('\n   4e. Pressing Tab to blur...');
    await page.keyboard.press('Tab');
    await sleep(300);
    
    // ========== STEP 5: FINAL STATE CHECK ==========
    console.log('\n📍 STEP 5: Final state check...');
    
    const finalState = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      
      const container = el.closest('[data-automation-id]') || el.parentElement?.parentElement?.parentElement;
      
      // Look for validation errors
      const errorElements = document.querySelectorAll('[data-automation-id*="error"], .error, [class*="error"], [class*="invalid"]');
      const errors = Array.from(errorElements).map(e => e.textContent?.substring(0, 100));
      
      // Check if field appears filled in Workday's eyes
      const hasValue = el.value || el.textContent;
      
      // Look for the actual form field value
      let formValue = null;
      if (container) {
        const hiddenInput = container.querySelector('input[type="hidden"]');
        if (hiddenInput) {
          formValue = hiddenInput.value;
        }
        const visibleInput = container.querySelector('input:not([type="hidden"])');
        if (visibleInput) {
          formValue = visibleInput.value;
        }
      }
      
      return {
        elementValue: el.value,
        elementTextContent: el.textContent?.substring(0, 100),
        formValue: formValue,
        errors: errors.filter(e => e && e.length > 0),
        hasVisualValue: hasValue && hasValue.length > 0
      };
    }, selector);
    
    console.log('   Final state:');
    console.log(`   - element.value: "${finalState.elementValue || ''}"`);
    console.log(`   - element.textContent: "${finalState.elementTextContent || ''}"`);
    console.log(`   - Form value (hidden input): "${finalState.formValue || ''}"`);
    console.log(`   - Has visual value: ${finalState.hasVisualValue}`);
    console.log(`   - Errors: ${finalState.errors.length > 0 ? finalState.errors.join(', ') : 'none'}`);
    
    // ========== SUMMARY ==========
    const success = finalState.formValue === value || 
                    finalState.elementValue === value ||
                    finalState.elementTextContent?.includes(value);
    
    console.log('\n' + '='.repeat(60));
    console.log(`📊 SUMMARY: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Expected: "${value}"`);
    console.log(`   Got: "${finalState.formValue || finalState.elementValue || finalState.elementTextContent || '(empty)'}"`);
    console.log('='.repeat(60) + '\n');
    
    return {
      success,
      elementInfo,
      alternatives,
      finalState
    };
  },

  // ============================================
  // DEBUG DROPDOWN FILL
  // ============================================
  async debugFillDropdown(page, selector, value, label) {
    console.log('\n' + '='.repeat(60));
    console.log(`🔬 DEBUG DROPDOWN: "${label}" → "${value}"`);
    console.log('='.repeat(60));
    
    // Find the button
    console.log('\n📍 Finding dropdown button...');
    const btn = await page.$(selector);
    
    if (!btn) {
      console.log('   ❌ Button NOT FOUND');
      return { success: false };
    }
    
    const btnInfo = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return {
        tag: el.tagName,
        text: el.textContent?.substring(0, 50),
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaHaspopup: el.getAttribute('aria-haspopup'),
        dataAutomationId: el.getAttribute('data-automation-id')
      };
    }, selector);
    
    console.log(`   Found: <${btnInfo.tag.toLowerCase()}>`);
    console.log(`   Text: "${btnInfo.text}"`);
    console.log(`   aria-expanded: ${btnInfo.ariaExpanded}`);
    console.log(`   data-automation-id: ${btnInfo.dataAutomationId}`);
    
    // Click to open
    console.log('\n📍 Clicking to open dropdown...');
    await btn.click();
    await sleep(500);
    
    // Check what options appeared
    const options = await page.evaluate(() => {
      const optionSelectors = [
        '[data-automation-id="promptOption"]',
        '[role="option"]',
        '[role="listbox"] li',
        '[data-automation-id="selectOption"]'
      ];
      
      for (const sel of optionSelectors) {
        const opts = document.querySelectorAll(sel);
        if (opts.length > 0) {
          return {
            selector: sel,
            count: opts.length,
            options: Array.from(opts).slice(0, 10).map(o => ({
              text: o.textContent?.trim().substring(0, 50),
              dataAutomationId: o.getAttribute('data-automation-id'),
              ariaSelected: o.getAttribute('aria-selected')
            }))
          };
        }
      }
      return { selector: null, count: 0, options: [] };
    });
    
    console.log(`   Found ${options.count} options using: ${options.selector}`);
    if (options.options.length > 0) {
      console.log('   Options:');
      for (const opt of options.options) {
        console.log(`   - "${opt.text}"`);
      }
    }
    
    // Close dropdown
    await page.keyboard.press('Escape');
    
    console.log('='.repeat(60) + '\n');
    
    return { options };
  }
};

export default WorkdayDebugger;
