// Claude Analyzer - Sends logs to Claude API and generates fixes
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import config from './config.js';

export class ClaudeAnalyzer {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey
    });
    this.conversationHistory = [];
  }

  async analyzeAndFix(testResult) {
    const { logs, domState, fillResults, screenshot, iteration, url } = testResult;
    
    console.log('🤖 Sending to Claude for analysis...');
    
    // Build the analysis prompt
    const prompt = this.buildAnalysisPrompt(logs, domState, fillResults, iteration, url);
    
    try {
      const response = await this.client.messages.create({
        model: config.model,
        max_tokens: 8000,
        system: this.getSystemPrompt(),
        messages: [
          ...this.conversationHistory,
          { role: 'user', content: prompt }
        ]
      });
      
      const assistantMessage = response.content[0].text;
      
      // Add to conversation history for context in subsequent iterations
      this.conversationHistory.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: assistantMessage }
      );
      
      // Keep conversation history manageable
      if (this.conversationHistory.length > 10) {
        this.conversationHistory = this.conversationHistory.slice(-6);
      }
      
      // Parse the response to extract fixes
      const fixes = this.parseFixesFromResponse(assistantMessage);
      
      console.log(`✅ Analysis complete. Found ${fixes.length} fixes.`);
      
      return {
        analysis: assistantMessage,
        fixes: fixes,
        rawResponse: response
      };
    } catch (error) {
      console.error(`❌ Claude API error: ${error.message}`);
      return {
        analysis: null,
        fixes: [],
        error: error.message
      };
    }
  }

  getSystemPrompt() {
    return `You are an expert JavaScript developer specializing in web automation with Puppeteer. You are debugging a direct form filler that automatically fills job application forms.

Your task is to analyze console logs and field results from failed form fills, identify the root cause, and generate precise code fixes.

The form filler architecture (files in the src/ directory):
- direct-form-filler.js: Main form filling logic - handles Workday, Greenhouse, and generic forms using page.evaluate()
- multi-page-navigator.js: Handles multi-page forms, navigation, and button detection
- runner.js: Puppeteer browser automation, screenshot capture, profile injection

Key technical details:
- All browser interactions happen inside page.evaluate() which runs in browser context
- Uses data-automation-id attributes for Workday fields
- Workday dropdowns need: click to open → type in searchBox → wait 500ms → click promptOption
- The code must be valid ES6 JavaScript that runs in browser context (inside page.evaluate)

When generating fixes, output them in this exact format:

<fix>
<file>direct-form-filler.js</file>
<description>Brief description of what this fix does</description>
<search>
EXACT code to find (must be unique in file)
</search>
<replace>
New code to replace it with
</replace>
</fix>

IMPORTANT RULES:
1. The <search> content must be an EXACT match of existing code (copy-paste precision)
2. Each fix should be minimal and targeted
3. Include the full context needed to make the search string unique
4. ONLY suggest fixes to: direct-form-filler.js, multi-page-navigator.js, or runner.js
5. Code inside page.evaluate() runs in BROWSER context (has access to document, window, etc.)
6. Code outside page.evaluate() runs in NODE context (has access to this.page, puppeteer, etc.)

Common issues to look for:
- Selectors not matching actual DOM elements
- Wrong data-automation-id patterns for Workday
- Not waiting long enough for async content
- Event dispatching not triggering React/framework updates
- Dropdown options not loading before trying to click`;
  }

  buildAnalysisPrompt(logs, domState, fillResults, iteration, url) {
    const jobfillLogs = logs.filter(l => 
      l.text.includes('JobFill') || l.text.includes('[JobFill') || l.text.includes('[DirectFiller]')
    );
    
    // Extract key information from logs
    const errorLogs = logs.filter(l => l.type === 'error');
    const debugLogs = jobfillLogs.filter(l => l.text.includes('DEBUG') || l.text.includes('DirectFiller'));
    
    // Find failed fields
    const failedFields = domState.fields?.filter(f => f.required && !f.filled) || [];
    
    // Get field log if available
    const fieldLog = fillResults?.fieldLog || [];
    const failedFills = fieldLog.filter(f => !f.success);
    const successFills = fieldLog.filter(f => f.success);

    return `## Debug Iteration ${iteration} for ${url}

### Fill Results Summary
- Fields Filled: ${fillResults?.filled || 0}
- Failed: ${fillResults?.failed || 0}  
- Skipped: ${fillResults?.skipped || 0}
${fillResults?.error ? `- Error: ${fillResults.error}` : ''}

### Successful Fills
${successFills.length > 0 ? successFills.map(f => `✅ ${f.label}: "${f.value}"`).join('\n') : 'None'}

### Failed Fills (FOCUS ON THESE)
${failedFills.length > 0 ? failedFills.map(f => `❌ ${f.label}: "${f.value}" - ${f.error || 'Unknown error'}`).join('\n') : 'None'}

### DOM State
- Platform Detected: ${domState.platform}
- Total Fields: ${domState.totalFields}
- Required Fields: ${domState.requiredFields}
- Required Filled: ${domState.requiredFilled}

### Required Fields Still Empty
${failedFields.map(f => `- ${f.label || f.name}: type=${f.type}, id=${f.id || 'none'}, classes=${f.classes?.substring(0, 50)}`).join('\n') || 'None detected'}

### Console Logs
\`\`\`
${debugLogs.slice(-30).map(l => l.text).join('\n')}
\`\`\`

### Errors
\`\`\`
${errorLogs.map(l => l.text).join('\n') || 'None'}
\`\`\`

### Analysis Request
1. Look at the "Failed Fills" section - these are the specific fields that didn't work
2. Analyze WHY each field failed (selector not found? wrong pattern? timing issue?)
3. Generate targeted code fixes for direct-form-filler.js to resolve the issues
4. Each fix should address a specific failed field

Please provide your analysis and fixes in the format specified.`;
  }

  parseFixesFromResponse(response) {
    const fixes = [];
    const fixRegex = /<fix>([\s\S]*?)<\/fix>/g;
    
    let match;
    while ((match = fixRegex.exec(response)) !== null) {
      const fixContent = match[1];
      
      const fileMatch = fixContent.match(/<file>(.*?)<\/file>/s);
      const descMatch = fixContent.match(/<description>(.*?)<\/description>/s);
      const searchMatch = fixContent.match(/<search>([\s\S]*?)<\/search>/);
      const replaceMatch = fixContent.match(/<replace>([\s\S]*?)<\/replace>/);
      
      if (fileMatch && searchMatch && replaceMatch) {
        fixes.push({
          file: fileMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : 'No description',
          search: searchMatch[1].trim(),
          replace: replaceMatch[1].trim()
        });
      }
    }
    
    return fixes;
  }

  async saveAnalysis(analysis, filename) {
    const filepath = join(config.reportsDir, filename);
    await writeFile(filepath, JSON.stringify(analysis, null, 2));
    console.log(`📊 Analysis saved: ${filename}`);
    return filepath;
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

export default ClaudeAnalyzer;
