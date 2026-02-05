#!/usr/bin/env node
// JobFill Auto-Debugger - Main Orchestrator
// Runs the negative feedback loop to automatically fix extension bugs

import { program } from 'commander';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { PuppeteerRunner } from './runner.js';
import { ClaudeAnalyzer } from './analyzer.js';
import { CodePatcher } from './patcher.js';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AutoDebugger {
  constructor(options = {}) {
    this.options = { ...config, ...options };
    this.runner = null;
    this.analyzer = new ClaudeAnalyzer();
    this.patcher = new CodePatcher();
    this.results = [];
    this.totalIterations = 0;
    this.successfulFixes = 0;
  }

  async initialize() {
    // Ensure directories exist
    await mkdir(config.logsDir, { recursive: true });
    await mkdir(config.screenshotsDir, { recursive: true });
    await mkdir(config.patchesDir, { recursive: true });
    await mkdir(config.reportsDir, { recursive: true });
    
    // Initialize browser
    this.runner = new PuppeteerRunner();
    await this.runner.initialize();
    
    return this;
  }

  async runSingleUrl(url, maxIterations = null) {
    const iterations = maxIterations || this.options.maxIterationsPerUrl;
    const urlSlug = new URL(url).hostname.replace(/\./g, '_');
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 Testing: ${url}`);
    console.log('='.repeat(60));
    
    let lastResult = null;
    let success = false;
    
    for (let i = 1; i <= iterations; i++) {
      console.log(`\n--- Iteration ${i}/${iterations} ---`);
      this.totalIterations++;
      
      // Navigate to the job application
      const navigated = await this.runner.navigateToJob(url);
      if (!navigated) {
        console.log('❌ Failed to navigate, skipping...');
        break;
      }
      
      // Run the fill
      const fillResults = await this.runner.runFill();
      console.log('Fill results:', fillResults);
      
      // Capture DOM state
      const domState = await this.runner.captureDOM();
      
      // Capture screenshot
      const screenshotFile = `${urlSlug}_iter${i}_${Date.now()}.png`;
      await this.runner.captureScreenshot(screenshotFile);
      
      // Save logs
      const logFile = `${urlSlug}_iter${i}_${Date.now()}.json`;
      await this.runner.saveLogs(logFile);
      
      // Check success criteria
      const successRate = domState.requiredFilled / Math.max(domState.requiredFields, 1);
      console.log(`📊 Success rate: ${(successRate * 100).toFixed(1)}% (${domState.requiredFilled}/${domState.requiredFields} required fields)`);
      
      if (successRate >= this.options.minSuccessRate) {
        console.log('🎉 SUCCESS! Minimum success rate achieved.');
        success = true;
        break;
      }
      
      if (domState.requiredFilled === domState.requiredFields) {
        console.log('🎉 SUCCESS! All required fields filled.');
        success = true;
        break;
      }
      
      // If not successful, analyze and fix
      console.log('🔍 Analyzing failures...');
      
      const analysisResult = await this.analyzer.analyzeAndFix({
        logs: this.runner.consoleLogs,
        domState: domState,
        fillResults: fillResults,
        iteration: i,
        url: url
      });
      
      // Save analysis
      const analysisFile = `${urlSlug}_analysis_iter${i}_${Date.now()}.json`;
      await this.analyzer.saveAnalysis(analysisResult, analysisFile);
      
      if (analysisResult.fixes.length === 0) {
        console.log('⚠️ No fixes generated. Claude may need more context.');
        
        // If no fixes for 2 consecutive iterations, break
        if (lastResult && lastResult.fixes.length === 0) {
          console.log('❌ No progress being made, stopping iterations.');
          break;
        }
      } else {
        // Apply fixes
        const patchResults = await this.patcher.applyFixes(analysisResult.fixes);
        const successfulPatches = patchResults.filter(r => r.success);
        
        this.successfulFixes += successfulPatches.length;
        
        if (successfulPatches.length === 0) {
          console.log('⚠️ No patches could be applied.');
        } else {
          console.log(`✅ Applied ${successfulPatches.length}/${analysisResult.fixes.length} fixes`);
          
          // Give browser time to reload extension changes
          console.log('🔄 Waiting for extension to reload...');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      lastResult = analysisResult;
    }
    
    const result = {
      url,
      success,
      iterations: this.totalIterations,
      fixesApplied: this.patcher.getAppliedPatches().length
    };
    
    this.results.push(result);
    return result;
  }

  async runBatch(urls) {
    console.log(`\n${'🚀'.repeat(20)}`);
    console.log(`Starting batch test of ${urls.length} URLs`);
    console.log(`${'🚀'.repeat(20)}\n`);
    
    const startTime = Date.now();
    
    for (let i = 0; i < urls.length; i++) {
      const urlConfig = typeof urls[i] === 'string' ? { url: urls[i] } : urls[i];
      
      console.log(`\n[${i + 1}/${urls.length}] ${urlConfig.platform || 'unknown'}: ${urlConfig.company || urlConfig.url}`);
      
      try {
        await this.runSingleUrl(urlConfig.url);
      } catch (error) {
        console.error(`Error testing ${urlConfig.url}: ${error.message}`);
        this.results.push({
          url: urlConfig.url,
          success: false,
          error: error.message
        });
      }
      
      // Pause between URLs
      if (i < urls.length - 1) {
        console.log(`\n⏳ Pausing ${this.options.pauseBetweenBatches / 1000}s before next URL...`);
        await new Promise(r => setTimeout(r, this.options.pauseBetweenBatches));
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    // Generate summary report
    await this.generateReport(duration);
    
    return this.results;
  }

  async generateReport(duration) {
    const successful = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    
    const report = {
      timestamp: new Date().toISOString(),
      duration: `${duration} minutes`,
      summary: {
        totalUrls: this.results.length,
        successful,
        failed,
        successRate: `${((successful / this.results.length) * 100).toFixed(1)}%`,
        totalIterations: this.totalIterations,
        totalFixesApplied: this.successfulFixes
      },
      results: this.results,
      appliedPatches: this.patcher.getAppliedPatches()
    };
    
    const reportPath = join(config.reportsDir, `report_${Date.now()}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL REPORT');
    console.log('='.repeat(60));
    console.log(`Duration: ${duration} minutes`);
    console.log(`URLs Tested: ${this.results.length}`);
    console.log(`Successful: ${successful} (${report.summary.successRate})`);
    console.log(`Failed: ${failed}`);
    console.log(`Total Iterations: ${this.totalIterations}`);
    console.log(`Fixes Applied: ${this.successfulFixes}`);
    console.log(`Report saved: ${reportPath}`);
    console.log('='.repeat(60));
    
    return report;
  }

  async cleanup() {
    if (this.runner) {
      await this.runner.close();
    }
  }

  async revertAllChanges() {
    await this.patcher.revertAll();
  }
}

// CLI interface
async function main() {
  program
    .name('jobfill-auto-debugger')
    .description('Automated debugging system for JobFill Pro')
    .version('1.0.0');

  program
    .option('-u, --url <url>', 'Test a single URL')
    .option('-b, --batch', 'Run batch test from test-urls.json')
    .option('-i, --iterations <n>', 'Max iterations per URL', parseInt)
    .option('--headless', 'Run in headless mode')
    .option('--revert', 'Revert all applied patches')
    .parse();

  const options = program.opts();
  
  // Check for API key
  if (!config.anthropicApiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set. Create a .env file with your API key.');
    console.log('\nExample .env file:');
    console.log('ANTHROPIC_API_KEY=sk-ant-...');
    console.log('EXTENSION_PATH=/path/to/jobfill-pro-v5/chrome-extension');
    process.exit(1);
  }
  
  const debugger_ = new AutoDebugger({
    headless: options.headless || false,
    maxIterationsPerUrl: options.iterations || 5
  });
  
  try {
    await debugger_.initialize();
    
    if (options.revert) {
      await debugger_.revertAllChanges();
    } else if (options.url) {
      // Single URL mode
      await debugger_.runSingleUrl(options.url);
    } else if (options.batch) {
      // Batch mode
      const testUrlsPath = join(__dirname, '../test-urls.json');
      const testUrls = JSON.parse(await readFile(testUrlsPath, 'utf-8'));
      await debugger_.runBatch(testUrls.urls);
    } else {
      // Interactive mode - prompt for URL
      console.log('Usage:');
      console.log('  --url <url>     Test a single URL');
      console.log('  --batch         Run batch test from test-urls.json');
      console.log('  --iterations <n> Max iterations per URL');
      console.log('  --headless      Run in headless mode');
      console.log('  --revert        Revert all patches');
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await debugger_.cleanup();
  }
}

// Export for programmatic use
export { AutoDebugger };

// Run if called directly
main().catch(console.error);
