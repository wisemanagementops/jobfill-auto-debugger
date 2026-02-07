#!/usr/bin/env node
// Assisted Mode - Manual login, then automated form filling
// Usage: node assisted-mode.js <url>

import readline from 'readline';
import { PuppeteerRunner } from './runner.js';
import { SessionManager } from './session-manager.js';
import { MultiPageNavigator } from './multi-page-navigator.js';
import { ProfileManager } from './profile-manager.js';
import { ClaudeAnalyzer } from './analyzer.js';
import { CodePatcher } from './patcher.js';
import { sleep, extractPlatformFromUrl } from './utils.js';
import config from './config.js';

class AssistedDebugger {
  constructor() {
    this.runner = null;
    this.sessionManager = null;
    this.navigator = null;
    this.profileManager = null;
    this.analyzer = new ClaudeAnalyzer();
    this.patcher = new CodePatcher();
    this.rl = null;
  }

  async initialize() {
    this.runner = new PuppeteerRunner();
    await this.runner.initialize();
    
    this.sessionManager = new SessionManager(this.runner);
    await this.sessionManager.initialize();
    
    this.navigator = new MultiPageNavigator(this.runner);
    
    this.profileManager = new ProfileManager();
    const profile = await this.profileManager.initialize();
    
    if (!profile) {
      console.log('\n❌ No profile found. Please create one first.');
      console.log('Run: npm run setup');
      process.exit(1);
    }
    
    this.profileManager.displayProfile();
    
    // Setup readline for user input
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return this;
  }

  async prompt(question) {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer.trim().toLowerCase());
      });
    });
  }

  async waitForUserReady(message) {
    console.log(`\n⏸️  ${message}`);
    console.log('   Press ENTER when ready to continue...');
    await this.prompt('');
  }

  async runAssisted(url) {
    const platform = extractPlatformFromUrl(url);
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 ASSISTED MODE: ${url}`);
    console.log(`📦 Platform: ${platform}`);
    console.log('='.repeat(60));

    // Check for saved session
    const hasSession = this.sessionManager.hasSession(url);
    if (hasSession) {
      const useSession = await this.prompt('Found saved session. Use it? (y/n): ');
      if (useSession === 'y') {
        await this.sessionManager.loadSession(url);
      }
    }

    // Navigate to URL
    await this.runner.navigateToJob(url);
    
    // Restore storage after navigation
    if (hasSession) {
      await this.sessionManager.restoreStorage(url);
      await this.runner.page.reload({ waitUntil: 'networkidle2' });
    }

    // Check if we're on a login page
    const isLogin = await this.navigator.isLoginPage();
    if (isLogin) {
      console.log('\n🔐 LOGIN REQUIRED');
      console.log('   Please log in manually in the browser window.');
      console.log('   The browser will remain open for you to complete the login.');
      
      await this.waitForUserReady('Complete login and navigate to the job application form');
      
      // Save session after login
      const saveSession = await this.prompt('Save this session for future use? (y/n): ');
      if (saveSession === 'y') {
        await this.sessionManager.saveCurrentSession(url);
      }
    }

    // Check for resume upload
    const hasResumeUpload = await this.runner.page.$('input[type="file"]');
    if (hasResumeUpload && this.profileManager.profile?.documents?.resumePath) {
      const uploadResume = await this.prompt('Resume upload detected. Upload your resume? (y/n): ');
      if (uploadResume === 'y') {
        await this.profileManager.uploadResume();
        await sleep(2000); // Wait for upload processing
      }
    }

    // Now we should be on the application form
    console.log('\n📋 Starting form filling loop...');
    
    let iteration = 0;
    const maxIterations = config.maxIterationsPerUrl;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`ITERATION ${iteration}/${maxIterations}`);
      console.log('─'.repeat(40));
      
      // Re-inject profile before each fill attempt
      await this.runner.injectProfile();

      // Navigate through all pages and fill
      const navResult = await this.navigator.navigateAllPages(async () => {
        // Re-inject profile on each page
        await this.runner.injectProfile();
        
        // Run fill on current page
        const fillResult = await this.runner.runFill();
        
        // Capture state
        const domState = await this.runner.captureDOM();
        
        // Take screenshot
        const timestamp = Date.now();
        await this.runner.captureScreenshot(`assisted_iter${iteration}_${timestamp}.png`);
        
        return { fillResult, domState };
      });

      // Log navigation result
      console.log(`\n📊 Navigation result: ${navResult.reason}`);
      console.log(`   Pages processed: ${navResult.results?.length || 0}`);

      // Calculate overall success
      let totalRequired = 0;
      let totalFilled = 0;
      
      for (const pageResult of (navResult.results || [])) {
        if (pageResult.fillResult?.domState) {
          totalRequired += pageResult.fillResult.domState.requiredFields || 0;
          totalFilled += pageResult.fillResult.domState.requiredFilled || 0;
        }
      }

      const successRate = totalRequired > 0 ? totalFilled / totalRequired : 0;
      console.log(`   Overall success: ${(successRate * 100).toFixed(1)}% (${totalFilled}/${totalRequired})`);

      // Check if we're done
      if (successRate >= config.minSuccessRate) {
        console.log('\n🎉 SUCCESS! Minimum success rate achieved.');
        break;
      }

      if (navResult.reason === 'login_required') {
        await this.waitForUserReady('Please complete login');
        continue;
      }

      if (navResult.reason === 'submission_page') {
        console.log('\n✅ Reached submission page.');
        const submit = await this.prompt('Submit the application? (y/n): ');
        if (submit === 'y') {
          console.log('⚠️  Submission not implemented - please submit manually');
        }
        break;
      }

      // Analyze failures and suggest fixes
      if (successRate < config.minSuccessRate) {
        console.log('\n🔍 Analyzing failures...');
        
        const analysis = await this.analyzer.analyzeAndFix({
          logs: this.runner.consoleLogs,
          domState: navResult.results?.[0]?.fillResult?.domState || {},
          fillResults: navResult.results?.[0]?.fillResult?.fillResult || {},
          iteration,
          url
        });

        if (analysis.fixes.length > 0) {
          console.log(`\n💡 Claude suggests ${analysis.fixes.length} fixes:`);
          analysis.fixes.forEach((fix, i) => {
            console.log(`   ${i + 1}. ${fix.description}`);
          });

          const applyFixes = await this.prompt('\nApply these fixes? (y/n): ');
          if (applyFixes === 'y') {
            await this.patcher.applyFixes(analysis.fixes);
            
            // Reload the page to test with new code
            console.log('🔄 Reloading page to test fixes...');
            await this.runner.page.reload({ waitUntil: 'networkidle2' });
            await sleep(2000);
          }
        } else {
          console.log('⚠️  No automatic fixes available.');
          const continueAnyway = await this.prompt('Continue to next iteration? (y/n): ');
          if (continueAnyway !== 'y') break;
        }
      }

      // Ask before next iteration
      if (iteration < maxIterations) {
        const nextIter = await this.prompt('\nRun another iteration? (y/n): ');
        if (nextIter !== 'y') break;
        
        // Go back to first page if needed
        await this.runner.page.goto(url, { waitUntil: 'networkidle2' });
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SESSION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Iterations: ${iteration}`);
    console.log(`Fixes applied: ${this.patcher.getAppliedPatches().length}`);
    
    // Save logs
    await this.runner.saveLogs(`assisted_${Date.now()}_final.json`);

    // Ask about reverting
    if (this.patcher.getAppliedPatches().length > 0) {
      const keepFixes = await this.prompt('\nKeep applied fixes? (y/n): ');
      if (keepFixes !== 'y') {
        await this.patcher.revertAll();
      }
    }
  }

  async cleanup() {
    if (this.runner) {
      // Create a new readline if needed for the prompt
      if (!this.rl) {
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
      }
      
      try {
        const closeBrowser = await this.prompt('\nClose browser? (y/n): ');
        if (closeBrowser === 'y') {
          await this.runner.close();
        } else {
          console.log('Browser left open. Close manually when done.');
        }
      } catch (e) {
        // If prompt fails, just close the browser
        await this.runner.close();
      }
    }
    
    if (this.rl) {
      this.rl.close();
    }
  }
}

// Main
async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.log('Usage: node assisted-mode.js <job-application-url>');
    console.log('\nExample:');
    console.log('  node assisted-mode.js "https://company.wd5.myworkdayjobs.com/careers/job/12345"');
    process.exit(1);
  }

  if (!config.anthropicApiKey) {
    console.error('⚠️  Warning: ANTHROPIC_API_KEY not set. Fix suggestions will be limited.');
  }

  const debugger_ = new AssistedDebugger();
  
  try {
    await debugger_.initialize();
    await debugger_.runAssisted(url);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await debugger_.cleanup();
  }
}

export { AssistedDebugger };

main().catch(console.error);
