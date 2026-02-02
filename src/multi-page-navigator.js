// Multi-Page Navigator - Handles multi-step job applications
import { sleep } from './utils.js';

export class MultiPageNavigator {
  constructor(runner) {
    this.runner = runner;
    this.currentPage = 0;
    this.totalPages = 0;
    this.pageHistory = [];
    this.maxPages = 10; // Safety limit
  }

  // Detect what page/step we're on
  async detectCurrentStep() {
    const page = this.runner.page;
    
    const stepInfo = await page.evaluate(() => {
      // Common step indicator patterns
      const stepIndicators = [
        // Progress bars with numbers
        '.progress-step.active',
        '.step.active',
        '.wizard-step.current',
        '[class*="step"][class*="active"]',
        '[class*="progress"][class*="current"]',
        
        // Breadcrumb style
        '.breadcrumb .active',
        '[aria-current="step"]',
        
        // Step counters (Step 1 of 4)
        '[class*="step-counter"]',
        '[class*="page-indicator"]'
      ];
      
      // Try to find step indicator
      for (const selector of stepIndicators) {
        const el = document.querySelector(selector);
        if (el) {
          return {
            found: true,
            text: el.textContent.trim(),
            selector
          };
        }
      }
      
      // Look for "Step X of Y" or "Page X of Y" text
      const bodyText = document.body.innerText;
      const stepMatch = bodyText.match(/(?:step|page)\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
      if (stepMatch) {
        return {
          found: true,
          currentStep: parseInt(stepMatch[1]),
          totalSteps: parseInt(stepMatch[2]),
          text: stepMatch[0]
        };
      }
      
      // Detect page type by content
      const pageType = detectPageType();
      
      return {
        found: false,
        pageType,
        url: window.location.href
      };
      
      function detectPageType() {
        const text = document.body.innerText.toLowerCase();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map(h => h.textContent.toLowerCase());
        
        if (text.includes('personal information') || headings.some(h => h.includes('personal'))) {
          return 'personal_info';
        }
        if (text.includes('work experience') || text.includes('employment history') || headings.some(h => h.includes('experience'))) {
          return 'experience';
        }
        if (text.includes('education') || headings.some(h => h.includes('education'))) {
          return 'education';
        }
        if (text.includes('upload') && text.includes('resume')) {
          return 'resume_upload';
        }
        if (text.includes('cover letter')) {
          return 'cover_letter';
        }
        if (text.includes('voluntary') || text.includes('eeo') || text.includes('demographic')) {
          return 'eeo_voluntary';
        }
        if (text.includes('review') && (text.includes('submit') || text.includes('application'))) {
          return 'review';
        }
        if (text.includes('sign in') || text.includes('log in') || text.includes('login')) {
          return 'login';
        }
        if (text.includes('create account') || text.includes('sign up') || text.includes('register')) {
          return 'registration';
        }
        if (text.includes('verify') && text.includes('email')) {
          return 'email_verification';
        }
        
        return 'unknown';
      }
    });
    
    console.log(`📍 Current step: ${stepInfo.pageType || stepInfo.text || 'unknown'}`);
    return stepInfo;
  }

  // Find and click the "Next" button
  async clickNext() {
    const page = this.runner.page;
    
    const nextButtonSelectors = [
      // Common button text patterns
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Save and Continue")',
      'button:has-text("Save & Continue")',
      'button:has-text("Proceed")',
      'button:has-text("Submit")',
      
      // Input submit buttons
      'input[type="submit"][value*="Next" i]',
      'input[type="submit"][value*="Continue" i]',
      'input[type="submit"][value*="Save" i]',
      
      // Links styled as buttons
      'a:has-text("Next")',
      'a:has-text("Continue")',
      
      // By class/id patterns
      '[class*="next-button"]',
      '[class*="continue-button"]',
      '[class*="submit-button"]',
      '#next-button',
      '#continue-button',
      '#btnNext',
      '#btnContinue',
      
      // ARIA labels
      '[aria-label*="next" i]',
      '[aria-label*="continue" i]',
      
      // Data attributes
      '[data-action="next"]',
      '[data-action="continue"]'
    ];
    
    // Try each selector
    for (const selector of nextButtonSelectors) {
      try {
        // Use a more robust approach - evaluate in page context
        const clicked = await page.evaluate((sel) => {
          // Handle :has-text pseudo selector manually
          if (sel.includes(':has-text(')) {
            const match = sel.match(/(.*):has-text\("(.*)"\)/);
            if (match) {
              const [, tagSelector, text] = match;
              const elements = document.querySelectorAll(tagSelector || '*');
              for (const el of elements) {
                if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
                  // Check if button is visible and enabled
                  if (el.offsetParent !== null && !el.disabled) {
                    el.click();
                    return { success: true, text: el.textContent.trim() };
                  }
                }
              }
            }
            return { success: false };
          }
          
          // Standard selector
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null && !el.disabled) {
            el.click();
            return { success: true, text: el.textContent?.trim() || el.value };
          }
          return { success: false };
        }, selector);
        
        if (clicked.success) {
          console.log(`➡️ Clicked: "${clicked.text}"`);
          
          // Wait for navigation or page update
          await this.waitForPageChange();
          return true;
        }
      } catch (e) {
        // Selector didn't match, try next
      }
    }
    
    console.log('❌ No Next/Continue button found');
    return false;
  }

  // Wait for page to change after clicking Next
  async waitForPageChange() {
    const page = this.runner.page;
    const startUrl = page.url();
    
    try {
      // Wait for either navigation or DOM change
      await Promise.race([
        page.waitForNavigation({ timeout: 10000, waitUntil: 'networkidle2' }).catch(() => {}),
        page.waitForFunction(
          (startUrl) => {
            // Check if URL changed
            if (window.location.href !== startUrl) return true;
            // Check if content significantly changed (for SPA)
            return false;
          },
          { timeout: 10000 },
          startUrl
        ).catch(() => {})
      ]);
      
      // Additional wait for dynamic content
      await sleep(1500);
      
    } catch (error) {
      // Timeout is okay - page might have updated via AJAX
      await sleep(2000);
    }
  }

  // Check for validation errors on current page
  async checkForErrors() {
    const page = this.runner.page;
    
    const errors = await page.evaluate(() => {
      const errorSelectors = [
        '.error-message',
        '.validation-error',
        '.field-error',
        '[class*="error"]',
        '[class*="invalid"]',
        '[role="alert"]',
        '.alert-danger',
        '.text-danger'
      ];
      
      const foundErrors = [];
      for (const selector of errorSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el.offsetParent !== null && el.textContent.trim()) {
            foundErrors.push({
              selector,
              text: el.textContent.trim().substring(0, 100)
            });
          }
        }
      }
      
      // Also check for required fields that are empty
      const emptyRequired = [];
      const requiredFields = document.querySelectorAll('[required], [aria-required="true"]');
      for (const field of requiredFields) {
        if (!field.value && field.offsetParent !== null) {
          const label = field.labels?.[0]?.textContent || 
                       field.getAttribute('aria-label') ||
                       field.name || field.id;
          emptyRequired.push(label?.trim()?.substring(0, 50));
        }
      }
      
      return { foundErrors, emptyRequired };
    });
    
    if (errors.foundErrors.length > 0) {
      console.log(`⚠️ Validation errors found: ${errors.foundErrors.length}`);
      errors.foundErrors.forEach(e => console.log(`   - ${e.text}`));
    }
    
    if (errors.emptyRequired.length > 0) {
      console.log(`⚠️ Empty required fields: ${errors.emptyRequired.length}`);
      errors.emptyRequired.slice(0, 5).forEach(f => console.log(`   - ${f}`));
    }
    
    return errors;
  }

  // Check if we're on the final submission page
  async isSubmissionPage() {
    const page = this.runner.page;
    
    return await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      
      // Check for submit button using standard approach
      let hasSubmitButton = !!document.querySelector('input[type="submit"][value*="Submit"], [class*="submit-application"]');
      
      // Also check button text content
      if (!hasSubmitButton) {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if ((btn.textContent || '').toLowerCase().includes('submit application')) {
            hasSubmitButton = true;
            break;
          }
        }
      }
      
      const indicators = [
        text.includes('review your application'),
        text.includes('ready to submit'),
        text.includes('submit your application'),
        text.includes('final step'),
        hasSubmitButton && text.includes('review')
      ];
      
      return indicators.some(i => i);
    });
  }

  // Check if we're on a login page
  async isLoginPage() {
    const page = this.runner.page;
    
    return await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      const hasPasswordField = !!document.querySelector('input[type="password"]');
      
      // Check for login buttons using standard selectors
      const buttons = document.querySelectorAll('button, input[type="submit"]');
      let hasLoginButton = false;
      for (const btn of buttons) {
        const btnText = (btn.textContent || btn.value || '').toLowerCase();
        if (btnText.includes('sign in') || btnText.includes('log in') || btnText.includes('login')) {
          hasLoginButton = true;
          break;
        }
      }
      
      return (text.includes('sign in') || text.includes('log in')) && 
             (hasPasswordField || hasLoginButton);
    });
  }

  // Navigate through all pages of the application
  async navigateAllPages(fillFunction, options = {}) {
    const { maxPages = this.maxPages, stopAtSubmit = true } = options;
    const results = [];
    
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      this.currentPage = pageNum;
      
      // Detect current step
      const stepInfo = await this.detectCurrentStep();
      this.pageHistory.push(stepInfo);
      
      // Check if we're on login page
      if (stepInfo.pageType === 'login') {
        console.log('🔐 Login page detected - manual intervention required');
        return { 
          completed: false, 
          reason: 'login_required',
          pageHistory: this.pageHistory 
        };
      }
      
      // Check if we're on submission page
      if (stopAtSubmit && await this.isSubmissionPage()) {
        console.log('✅ Reached submission page');
        return { 
          completed: true, 
          reason: 'submission_page',
          pageHistory: this.pageHistory,
          results 
        };
      }
      
      // Run fill on current page
      console.log(`\n📄 Filling page ${pageNum + 1}...`);
      const fillResult = await fillFunction();
      results.push({
        page: pageNum + 1,
        stepInfo,
        fillResult
      });
      
      // Check for errors
      const errors = await this.checkForErrors();
      if (errors.foundErrors.length > 0 || errors.emptyRequired.length > 0) {
        console.log('⚠️ Errors found, may need to fix before proceeding');
      }
      
      // Try to go to next page
      const hasNext = await this.clickNext();
      if (!hasNext) {
        console.log('📍 No more pages or could not proceed');
        return {
          completed: true,
          reason: 'no_next_button',
          pageHistory: this.pageHistory,
          results
        };
      }
      
      // Small delay between pages
      await sleep(1000);
    }
    
    return {
      completed: false,
      reason: 'max_pages_reached',
      pageHistory: this.pageHistory,
      results
    };
  }
}

export default MultiPageNavigator;
