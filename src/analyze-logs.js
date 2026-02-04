#!/usr/bin/env node
// Standalone Log Analyzer - Analyze existing logs without running browser
// Usage: node analyze-logs.js <log-file.json>

import { readFile, writeFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';

async function analyzeLogFile(logPath) {
  console.log(`\n📂 Analyzing: ${basename(logPath)}`);
  
  const logData = JSON.parse(await readFile(logPath, 'utf-8'));
  
  // Extract JobFill-specific logs
  const jobfillLogs = logData.consoleLogs.filter(l => 
    l.text.includes('JobFill') || l.text.includes('[JobFill')
  );
  
  const debugLogs = jobfillLogs.filter(l => l.text.includes('DEBUG'));
  const errorLogs = logData.errors || [];
  
  console.log(`   Total logs: ${logData.consoleLogs.length}`);
  console.log(`   JobFill logs: ${jobfillLogs.length}`);
  console.log(`   Debug logs: ${debugLogs.length}`);
  console.log(`   Errors: ${errorLogs.length}`);
  
  // Identify patterns
  const patterns = analyzePatterns(debugLogs);
  console.log('\n📊 Detected Patterns:');
  console.log(`   Dropdowns attempted: ${patterns.dropdownAttempts}`);
  console.log(`   Dropdowns succeeded: ${patterns.dropdownSuccesses}`);
  console.log(`   Radio buttons attempted: ${patterns.radioAttempts}`);
  console.log(`   Radio buttons succeeded: ${patterns.radioSuccesses}`);
  console.log(`   Stale popup issues: ${patterns.stalePopups}`);
  console.log(`   No match found: ${patterns.noMatchFound}`);
  
  return {
    logPath,
    summary: logData.summary,
    patterns,
    debugLogs,
    errorLogs
  };
}

function analyzePatterns(logs) {
  const patterns = {
    dropdownAttempts: 0,
    dropdownSuccesses: 0,
    radioAttempts: 0,
    radioSuccesses: 0,
    stalePopups: 0,
    noMatchFound: 0,
    failedFields: []
  };
  
  for (const log of logs) {
    const text = log.text;
    
    if (text.includes('handleSapUI5Select')) patterns.dropdownAttempts++;
    if (text.includes('EXACT match, clicking') || text.includes('CONTAINS match')) patterns.dropdownSuccesses++;
    if (text.includes('handleSapUI5RadioGroup')) patterns.radioAttempts++;
    if (text.includes('Clicking radio for')) patterns.radioSuccesses++;
    if (text.includes('Available options:') && text.includes('Looking for:')) {
      // Check if options seem wrong for the field
      const optionsMatch = text.match(/Available options: \[(.*?)\]/);
      const lookingMatch = text.match(/Looking for: (.*)/);
      if (optionsMatch && lookingMatch) {
        // Detect stale popup by checking if options don't match expected
        const options = optionsMatch[1].toLowerCase();
        const looking = lookingMatch[1].toLowerCase();
        if (!options.includes(looking.split(' ')[0])) {
          patterns.stalePopups++;
        }
      }
    }
    if (text.includes('No matching item found for:')) {
      patterns.noMatchFound++;
      const match = text.match(/No matching item found for: (.*)/);
      if (match) patterns.failedFields.push(match[1]);
    }
  }
  
  return patterns;
}

async function sendToClaude(analysis) {
  if (!config.anthropicApiKey) {
    console.log('\n⚠️ No API key - skipping Claude analysis');
    return null;
  }
  
  console.log('\n🤖 Sending to Claude for deep analysis...');
  
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  
  const prompt = `Analyze these JobFill Pro debug logs and identify issues:

## Summary
- Debug logs: ${analysis.debugLogs.length}
- Dropdown attempts: ${analysis.patterns.dropdownAttempts}, successes: ${analysis.patterns.dropdownSuccesses}
- Radio attempts: ${analysis.patterns.radioAttempts}, successes: ${analysis.patterns.radioSuccesses}
- Stale popup issues detected: ${analysis.patterns.stalePopups}
- No match found: ${analysis.patterns.noMatchFound}
- Failed fields: ${analysis.patterns.failedFields.join(', ')}

## Debug Logs
\`\`\`
${analysis.debugLogs.map(l => l.text).join('\n')}
\`\`\`

## Errors
\`\`\`
${analysis.errorLogs.map(l => l.message || l.text).join('\n')}
\`\`\`

Please:
1. Identify the root causes of failures
2. Explain what's happening in the logs
3. Suggest specific code fixes`;

  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    
    return response.content[0].text;
  } catch (error) {
    console.error(`Claude API error: ${error.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Analyze all logs in logs directory
    console.log('📁 Analyzing all logs in logs/ directory...');
    
    try {
      const files = await readdir(config.logsDir);
      const logFiles = files.filter(f => f.endsWith('.json'));
      
      if (logFiles.length === 0) {
        console.log('No log files found. Run the auto-debugger first.');
        return;
      }
      
      for (const file of logFiles.slice(-5)) { // Last 5 logs
        const analysis = await analyzeLogFile(join(config.logsDir, file));
        
        if (args.includes('--claude')) {
          const claudeAnalysis = await sendToClaude(analysis);
          if (claudeAnalysis) {
            console.log('\n📝 Claude Analysis:');
            console.log(claudeAnalysis);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading logs directory: ${error.message}`);
    }
  } else {
    // Analyze specific file
    const analysis = await analyzeLogFile(args[0]);
    
    if (args.includes('--claude')) {
      const claudeAnalysis = await sendToClaude(analysis);
      if (claudeAnalysis) {
        console.log('\n📝 Claude Analysis:');
        console.log(claudeAnalysis);
      }
    }
  }
}

main().catch(console.error);
