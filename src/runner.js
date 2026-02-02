// Puppeteer Runner - Handles browser automation and log capture
import puppeteer from 'puppeteer';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PuppeteerRunner {
  constructor() {
    this.browser = null;
    this.page = null;
    this.consoleLogs = [];
    this.networkRequests = [];
    this.errors = [];
    this.profile = null;
  }

  async initialize() {
    console.log('🚀 Launching browser...');
    
    // Load profile
    await this.loadProfile();
    
    // Build browser args
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--allow-file-access-from-files'
    ];

    // Only load extension if path is provided and exists
    if (config.extensionPath && existsSync(config.extensionPath)) {
      browserArgs.push(`--disable-extensions-except=${config.extensionPath}`);
      browserArgs.push(`--load-extension=${config.extensionPath}`);
      console.log(`📦 Extension: ${config.extensionPath}`);
    } else {
      console.log('📦 No extension loaded (using direct form filler)');
    }

    this.browser = await puppeteer.launch({
      headless: config.headless,
      slowMo: config.slowMo,
      args: browserArgs,
      defaultViewport: {
        width: 1440,
        height: 900
      }
    });

    this.page = await this.browser.newPage();
    this.setupListeners();
    
    console.log('✅ Browser ready');
    if (this.profile) {
      console.log(`👤 Profile loaded: ${this.profile.personal.firstName} ${this.profile.personal.lastName}`);
    } else {
      console.log('⚠️  No profile found. Run: npm run setup');
    }
    return this;
  }

  async loadProfile() {
    const profilePath = join(__dirname, '../profile.json');
    if (existsSync(profilePath)) {
      try {
        this.profile = JSON.parse(await readFile(profilePath, 'utf-8'));
      } catch (error) {
        console.log('⚠️  Error loading profile:', error.message);
      }
    }
  }

  // Convert profile to extension format and inject into page
  async injectProfile() {
    if (!this.profile) {
      console.log('⚠️  No profile to inject');
      return false;
    }

    const extensionProfile = {
      // Direct mappings (Phase 1)
      email: this.profile.personal.email,
      firstName: this.profile.personal.firstName,
      lastName: this.profile.personal.lastName,
      middleName: this.profile.personal.middleName,
      fullName: `${this.profile.personal.firstName} ${this.profile.personal.lastName}`,
      phone: this.profile.personal.phone,
      linkedIn: this.profile.personal.linkedIn,
      website: this.profile.personal.website,
      
      // Address
      address: this.profile.address.line1,
      addressLine2: this.profile.address.line2,
      city: this.profile.address.city,
      state: this.profile.address.state,
      zipCode: this.profile.address.zipCode,
      country: this.profile.address.country,
      
      // Work auth
      workAuthorization: this.profile.workAuth.authorizedToWork,
      requiresSponsorship: this.profile.workAuth.requiresSponsorship,
      visaStatus: this.profile.workAuth.visaStatus,
      
      // EEO
      gender: this.profile.eeo.gender,
      ethnicity: this.profile.eeo.race,
      veteranStatus: this.profile.eeo.veteranStatus,
      disabilityStatus: this.profile.eeo.disabilityStatus,
      
      // Employment
      yearsExperience: this.profile.employment.yearsOfExperience,
      desiredSalary: this.profile.employment.desiredSalary,
      startDate: this.profile.employment.availableStartDate,
      willingToRelocate: this.profile.employment.willingToRelocate,
      
      // Education
      degree: this.profile.education.degree,
      fieldOfStudy: this.profile.education.fieldOfStudy,
      school: this.profile.education.school,
      graduationYear: this.profile.education.graduationYear,
      
      // Additional
      over18: this.profile.additional.over18,
      
      // Resume path (for upload handling)
      resumePath: this.profile.documents.resumePath,
    };

    // Inject into page's window object so extension can access it
    await this.page.evaluate((profile) => {
      window.jobFillProfile = profile;
      
      // Also store in localStorage for extension to read
      localStorage.setItem('jobfill_profile', JSON.stringify(profile));
      
      console.log('[JobFill Auto-Debug] Profile injected:', profile.firstName, profile.lastName);
    }, extensionProfile);

    console.log('💉 Profile injected into page');
    return true;
  }

  setupListeners() {
    // Capture all console logs
    this.page.on('console', msg => {
      const logEntry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location()
      };
      this.consoleLogs.push(logEntry);
      
      // Also print JobFill logs to terminal
      if (msg.text().includes('JobFill') || msg.text().includes('[JobFill')) {
        const color = msg.type() === 'error' ? '\x1b[31m' : 
                      msg.type() === 'warning' ? '\x1b[33m' : '\x1b[36m';
        console.log(`${color}[BROWSER] ${msg.text()}\x1b[0m`);
      }
    });

    // Capture errors
    this.page.on('pageerror', error => {
      this.errors.push({
        type: 'pageerror',
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      console.log(`\x1b[31m[ERROR] ${error.message}\x1b[0m`);
    });

    // Capture request failures
    this.page.on('requestfailed', request => {
      this.errors.push({
        type: 'requestfailed',
        url: request.url(),
        reason: request.failure()?.errorText,
        timestamp: new Date().toISOString()
      });
    });

    // Track network requests (useful for understanding AJAX calls)
    this.page.on('request', request => {
      if (request.url().includes('picklist') || request.url().includes('ajax')) {
        this.networkRequests.push({
          url: request.url(),
          method: request.method(),
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  clearLogs() {
    this.consoleLogs = [];
    this.networkRequests = [];
    this.errors = [];
  }

  // Helper function to wait (replaces deprecated waitForTimeout)
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async navigateToJob(url) {
    console.log(`📍 Navigating to: ${url}`);
    this.clearLogs();
    
    try {
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: config.pageLoadTimeout
      });
      
      // Wait for page to stabilize
      await this.wait(2000);
      
      // Inject profile data into page
      await this.injectProfile();
      
      console.log('✅ Page loaded');
      return true;
    } catch (error) {
      console.error(`❌ Navigation failed: ${error.message}`);
      return false;
    }
  }

  async runFill() {
    console.log('🔄 Running JobFill...');
    
    try {
      // Use DirectFormFiller to fill forms using Puppeteer
      const { DirectFormFiller } = await import('./direct-form-filler.js');
      const filler = new DirectFormFiller(this.page, this.profile);
      
      // Fill all fields (includes resume upload)
      const results = await filler.fillAllFields();
      
      // Wait for any dynamic updates
      await this.wait(1000);
      
      return results;
    } catch (error) {
      console.error(`❌ Fill execution failed: ${error.message}`);
      return { error: error.message, filled: 0, failed: 0, skipped: 0 };
    }
  }

  async getFillResults() {
    try {
      return await this.page.evaluate(() => {
        return window.lastFillResults || window.jobfillResults || null;
      });
    } catch {
      return null;
    }
  }

  // Upload resume to file input elements
  async uploadResume() {
    if (!this.profile?.documents?.resumePath) {
      console.log('📎 No resume path configured');
      return false;
    }

    const resumePath = this.profile.documents.resumePath;
    
    // Check if file exists
    const { existsSync } = await import('fs');
    if (!existsSync(resumePath)) {
      console.log(`⚠️  Resume file not found: ${resumePath}`);
      return false;
    }

    try {
      // Find file input elements for resume upload
      const fileInputSelectors = [
        'input[type="file"][name*="resume" i]',
        'input[type="file"][name*="cv" i]',
        'input[type="file"][id*="resume" i]',
        'input[type="file"][id*="cv" i]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][accept*=".doc"]',
        'input[type="file"]'  // Last resort: any file input
      ];

      for (const selector of fileInputSelectors) {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          // Check if this input is for resume (look at nearby labels)
          const isResume = await this.page.evaluate((sel) => {
            const input = document.querySelector(sel);
            if (!input) return false;
            
            // Check labels and nearby text
            const container = input.closest('div, label, fieldset');
            const text = container?.textContent?.toLowerCase() || '';
            
            return text.includes('resume') || 
                   text.includes('cv') || 
                   text.includes('upload') ||
                   input.name?.toLowerCase().includes('resume') ||
                   input.id?.toLowerCase().includes('resume');
          }, selector);

          if (isResume || selector === 'input[type="file"]') {
            await fileInput.uploadFile(resumePath);
            console.log(`📎 Resume uploaded: ${resumePath}`);
            
            // Wait for upload to process
            await this.wait(2000);
            return true;
          }
        }
      }

      console.log('📎 No resume upload field found on this page');
      return false;
    } catch (error) {
      console.error(`❌ Resume upload failed: ${error.message}`);
      return false;
    }
  }

  async captureScreenshot(filename) {
    const filepath = join(config.screenshotsDir, filename);
    
    // Ensure screenshots directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(config.screenshotsDir, { recursive: true });
    
    await this.page.screenshot({ 
      path: filepath, 
      fullPage: true 
    });
    console.log(`📸 Screenshot saved: ${filename}`);
    return filepath;
  }

  async captureDOM() {
    return await this.page.evaluate(() => {
      // Get form fields and their states
      const forms = document.querySelectorAll('form');
      const fields = [];
      
      forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, textarea, [role="combobox"], [role="listbox"]');
        inputs.forEach(input => {
          fields.push({
            tag: input.tagName,
            type: input.type || input.getAttribute('role'),
            name: input.name || input.id,
            value: input.value,
            label: input.labels?.[0]?.textContent || 
                   input.getAttribute('aria-label') ||
                   input.closest('label')?.textContent?.trim()?.substring(0, 50),
            required: input.required || input.getAttribute('aria-required') === 'true',
            filled: !!input.value,
            classes: input.className?.substring(0, 100),
            visible: input.offsetParent !== null
          });
        });
      });
      
      return {
        url: window.location.href,
        title: document.title,
        platform: window.detectedPlatform || 'unknown',
        totalFields: fields.length,
        filledFields: fields.filter(f => f.filled).length,
        requiredFields: fields.filter(f => f.required).length,
        requiredFilled: fields.filter(f => f.required && f.filled).length,
        fields: fields
      };
    });
  }

  async saveLogs(filename) {
    const filepath = join(config.logsDir, filename);
    
    // Ensure logs directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(config.logsDir, { recursive: true });
    
    const logData = {
      timestamp: new Date().toISOString(),
      url: this.page.url(),
      consoleLogs: this.consoleLogs,
      networkRequests: this.networkRequests,
      errors: this.errors,
      summary: {
        totalLogs: this.consoleLogs.length,
        errorCount: this.errors.length,
        jobfillLogs: this.consoleLogs.filter(l => l.text.includes('JobFill')).length
      }
    };
    
    await writeFile(filepath, JSON.stringify(logData, null, 2));
    console.log(`📝 Logs saved: ${filename}`);
    return filepath;
  }

  getJobFillLogs() {
    return this.consoleLogs.filter(log => 
      log.text.includes('JobFill') || 
      log.text.includes('[JobFill')
    );
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🛑 Browser closed');
    }
  }
}

export default PuppeteerRunner;
