// Configuration for JobFill Auto-Debugger
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  // Anthropic API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',
  
  // Paths
  extensionPath: process.env.EXTENSION_PATH,  // Optional - forms filled directly by Puppeteer
  srcDir: __dirname,  // This project's src directory
  logsDir: join(__dirname, '../logs'),
  screenshotsDir: join(__dirname, '../screenshots'),
  patchesDir: join(__dirname, '../patches'),
  reportsDir: join(__dirname, '../reports'),
  
  // Test settings
  maxIterationsPerUrl: 5,        // Max debug iterations per job URL
  fillTimeout: 15000,            // Time to wait for fill to complete (ms)
  pageLoadTimeout: 30000,        // Time to wait for page load (ms)
  
  // Batch settings
  batchSize: 10,                 // URLs to test in parallel
  pauseBetweenBatches: 5000,     // Pause between batches (ms)
  
  // Success criteria
  minSuccessRate: 0.85,          // 85% fields filled = success
  requiredFieldsMustPass: true,  // All required fields must be filled
  
  // Browser settings
  headless: false,               // Set to true for faster execution
  slowMo: 50,                    // Slow down actions for debugging
  
  // Files to patch (relative to src directory - these are the auto-debugger's own files)
  patchableFiles: [
    'direct-form-filler.js',
    'multi-page-navigator.js',
    'runner.js'
  ]
};

export default config;
