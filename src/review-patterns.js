#!/usr/bin/env node
/**
 * Pattern Review Tool
 * 
 * Use this for nightly/weekly reviews of newly learned patterns.
 * 
 * Commands:
 *   node review-patterns.js                    # Show all unverified patterns
 *   node review-patterns.js --all              # Show all patterns
 *   node review-patterns.js --recent 7         # Show patterns from last 7 days
 *   node review-patterns.js --stats            # Show statistics
 *   node review-patterns.js --verify <index>   # Mark pattern as verified
 *   node review-patterns.js --reject <index>   # Delete incorrect pattern
 *   node review-patterns.js --fix <index> <type>  # Correct pattern type
 *   node review-patterns.js --export           # Export to CSV for review
 *   node review-patterns.js --verify-all       # Mark all unverified as verified
 */

import fs from 'fs';
import path from 'path';

const CACHE_FILE = './cache/learned-patterns.json';

// ============================================================================
// LOAD PATTERNS
// ============================================================================
function loadPatterns() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading patterns: ${error.message}`);
  }
  return {};
}

function savePatterns(patterns) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(patterns, null, 2), 'utf-8');
    console.log('✅ Patterns saved');
  } catch (error) {
    console.error(`Error saving patterns: ${error.message}`);
  }
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================
function printTable(rows, title) {
  console.log('\n' + '═'.repeat(120));
  console.log(title);
  console.log('═'.repeat(120));
  
  if (rows.length === 0) {
    console.log('   (No patterns to show)');
    console.log('═'.repeat(120) + '\n');
    return;
  }
  
  // Header
  console.log(
    ' # '.padEnd(4) +
    '│ Status '.padEnd(11) +
    '│ ATS '.padEnd(12) +
    '│ Field Type '.padEnd(30) +
    '│ Original Label '.padEnd(45) +
    '│ Learned From'
  );
  console.log('─'.repeat(120));
  
  // Rows
  rows.forEach((row, index) => {
    const status = row.verified ? '✓ Verified' : '⚠ Review';
    const label = (row.originalLabel || '').substring(0, 40);
    const type = (row.type || '').substring(0, 26);
    const ats = (row.ats || 'unknown').substring(0, 8);
    const source = row.learnedFrom || 'unknown';
    
    console.log(
      String(index + 1).padStart(2).padEnd(4) +
      '│ ' + status.padEnd(9) +
      '│ ' + ats.padEnd(10) +
      '│ ' + type.padEnd(28) +
      '│ ' + label.padEnd(43) +
      '│ ' + source
    );
  });
  
  console.log('═'.repeat(120) + '\n');
}

function printDetailedPattern(pattern, index) {
  console.log('\n' + '─'.repeat(80));
  console.log(`Pattern #${index + 1}`);
  console.log('─'.repeat(80));
  console.log(`   Label:        ${pattern.originalLabel}`);
  console.log(`   Field ID:     ${pattern.originalId || 'N/A'}`);
  console.log(`   Type:         ${pattern.type}`);
  console.log(`   ATS:          ${pattern.ats}`);
  console.log(`   Company:      ${pattern.company}`);
  console.log(`   Learned:      ${pattern.learnedAt}`);
  console.log(`   Source:       ${pattern.learnedFrom}`);
  console.log(`   Verified:     ${pattern.verified ? 'Yes' : 'No'}`);
  console.log(`   Usage Count:  ${pattern.usageCount || 1}`);
  console.log(`   Last Used:    ${pattern.lastUsedAt || 'N/A'}`);
  console.log('─'.repeat(80) + '\n');
}

function printStats(patterns) {
  const all = Object.values(patterns);
  const verified = all.filter(p => p.verified);
  const unverified = all.filter(p => !p.verified);
  
  // Group by ATS
  const byATS = {};
  all.forEach(p => {
    const ats = p.ats || 'unknown';
    byATS[ats] = (byATS[ats] || 0) + 1;
  });
  
  // Group by type
  const byType = {};
  all.forEach(p => {
    const type = p.type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  });
  
  // Recent patterns (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentCount = all.filter(p => new Date(p.learnedAt) > weekAgo).length;
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 PATTERN STATISTICS');
  console.log('═'.repeat(60));
  console.log(`   Total Patterns:       ${all.length}`);
  console.log(`   ├── ✓ Verified:       ${verified.length}`);
  console.log(`   └── ⚠ Needs Review:   ${unverified.length}`);
  console.log('─'.repeat(60));
  console.log(`   Learned This Week:    ${recentCount}`);
  console.log('─'.repeat(60));
  console.log('   By ATS Platform:');
  Object.entries(byATS).sort((a, b) => b[1] - a[1]).forEach(([ats, count]) => {
    console.log(`      ${ats.padEnd(15)} ${count}`);
  });
  console.log('─'.repeat(60));
  console.log('   Top Field Types:');
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([type, count]) => {
      console.log(`      ${type.padEnd(30)} ${count}`);
    });
  console.log('═'.repeat(60) + '\n');
}

// ============================================================================
// ACTION FUNCTIONS
// ============================================================================
function verifyPattern(patterns, index) {
  const keys = Object.keys(patterns);
  const unverifiedKeys = keys.filter(k => !patterns[k].verified);
  
  if (index < 1 || index > unverifiedKeys.length) {
    console.error(`Invalid index. Must be between 1 and ${unverifiedKeys.length}`);
    return;
  }
  
  const key = unverifiedKeys[index - 1];
  patterns[key].verified = true;
  patterns[key].verifiedAt = new Date().toISOString();
  patterns[key].verifiedBy = 'manual_review';
  
  console.log(`\n✅ Verified pattern #${index}:`);
  console.log(`   "${patterns[key].originalLabel}" → ${patterns[key].type}`);
  
  savePatterns(patterns);
}

function rejectPattern(patterns, index) {
  const keys = Object.keys(patterns);
  const unverifiedKeys = keys.filter(k => !patterns[k].verified);
  
  if (index < 1 || index > unverifiedKeys.length) {
    console.error(`Invalid index. Must be between 1 and ${unverifiedKeys.length}`);
    return;
  }
  
  const key = unverifiedKeys[index - 1];
  const pattern = patterns[key];
  
  console.log(`\n❌ Rejecting pattern #${index}:`);
  console.log(`   "${pattern.originalLabel}" → ${pattern.type}`);
  
  delete patterns[key];
  savePatterns(patterns);
  
  console.log('   Pattern deleted. It will be re-learned next time (hopefully correctly).');
}

function fixPattern(patterns, index, newType) {
  const keys = Object.keys(patterns);
  const unverifiedKeys = keys.filter(k => !patterns[k].verified);
  
  if (index < 1 || index > unverifiedKeys.length) {
    console.error(`Invalid index. Must be between 1 and ${unverifiedKeys.length}`);
    return;
  }
  
  const key = unverifiedKeys[index - 1];
  const oldType = patterns[key].type;
  
  patterns[key].type = newType;
  patterns[key].verified = true;
  patterns[key].verifiedAt = new Date().toISOString();
  patterns[key].verifiedBy = 'manual_correction';
  patterns[key].correctedFrom = oldType;
  
  console.log(`\n🔧 Fixed pattern #${index}:`);
  console.log(`   "${patterns[key].originalLabel}"`);
  console.log(`   Old type: ${oldType}`);
  console.log(`   New type: ${newType}`);
  
  savePatterns(patterns);
}

function verifyAll(patterns) {
  const unverifiedKeys = Object.keys(patterns).filter(k => !patterns[k].verified);
  
  if (unverifiedKeys.length === 0) {
    console.log('\n✅ No unverified patterns to verify.');
    return;
  }
  
  console.log(`\n⚠️  About to verify ${unverifiedKeys.length} patterns.`);
  console.log('   This marks ALL unverified patterns as correct.');
  console.log('\n   Patterns to verify:');
  
  unverifiedKeys.forEach((key, i) => {
    const p = patterns[key];
    console.log(`   ${i + 1}. "${p.originalLabel}" → ${p.type}`);
  });
  
  // Mark all as verified
  unverifiedKeys.forEach(key => {
    patterns[key].verified = true;
    patterns[key].verifiedAt = new Date().toISOString();
    patterns[key].verifiedBy = 'bulk_verification';
  });
  
  savePatterns(patterns);
  console.log(`\n✅ Verified ${unverifiedKeys.length} patterns.`);
}

function exportToCSV(patterns) {
  const rows = Object.entries(patterns).map(([key, p]) => ({
    key,
    label: p.originalLabel,
    fieldId: p.originalId,
    type: p.type,
    ats: p.ats,
    company: p.company,
    verified: p.verified ? 'Yes' : 'No',
    learnedAt: p.learnedAt,
    usageCount: p.usageCount || 1,
  }));
  
  const header = 'Label,Field ID,Type,ATS,Company,Verified,Learned At,Usage Count';
  const csvRows = rows.map(r => 
    `"${r.label}","${r.fieldId}","${r.type}","${r.ats}","${r.company}","${r.verified}","${r.learnedAt}",${r.usageCount}`
  );
  
  const csv = [header, ...csvRows].join('\n');
  const filename = `patterns-export-${new Date().toISOString().split('T')[0]}.csv`;
  
  fs.writeFileSync(filename, csv, 'utf-8');
  console.log(`\n📁 Exported ${rows.length} patterns to ${filename}`);
}

// ============================================================================
// MAIN
// ============================================================================
function main() {
  const args = process.argv.slice(2);
  const patterns = loadPatterns();
  
  if (args.length === 0 || args[0] === '--unverified') {
    // Show unverified patterns
    const unverified = Object.entries(patterns)
      .filter(([_, p]) => !p.verified)
      .map(([key, p]) => ({ key, ...p }))
      .sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt));
    
    printTable(unverified, '⚠️  UNVERIFIED PATTERNS (Need Review)');
    
    if (unverified.length > 0) {
      console.log('Commands:');
      console.log('  --verify <#>       Mark pattern as correct');
      console.log('  --reject <#>       Delete incorrect pattern');
      console.log('  --fix <#> <type>   Correct the field type');
      console.log('  --verify-all       Mark all as verified');
      console.log('');
    }
    return;
  }
  
  if (args[0] === '--all') {
    const all = Object.entries(patterns)
      .map(([key, p]) => ({ key, ...p }))
      .sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt));
    printTable(all, '📋 ALL LEARNED PATTERNS');
    return;
  }
  
  if (args[0] === '--recent') {
    const days = parseInt(args[1]) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const recent = Object.entries(patterns)
      .filter(([_, p]) => new Date(p.learnedAt) > cutoff)
      .map(([key, p]) => ({ key, ...p }))
      .sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt));
    
    printTable(recent, `📅 PATTERNS LEARNED IN LAST ${days} DAYS`);
    return;
  }
  
  if (args[0] === '--stats') {
    printStats(patterns);
    return;
  }
  
  if (args[0] === '--verify') {
    const index = parseInt(args[1]);
    if (isNaN(index)) {
      console.error('Usage: --verify <pattern_number>');
      return;
    }
    verifyPattern(patterns, index);
    return;
  }
  
  if (args[0] === '--reject') {
    const index = parseInt(args[1]);
    if (isNaN(index)) {
      console.error('Usage: --reject <pattern_number>');
      return;
    }
    rejectPattern(patterns, index);
    return;
  }
  
  if (args[0] === '--fix') {
    const index = parseInt(args[1]);
    const newType = args[2];
    if (isNaN(index) || !newType) {
      console.error('Usage: --fix <pattern_number> <new_field_type>');
      console.error('Example: --fix 3 phone_type');
      return;
    }
    fixPattern(patterns, index, newType);
    return;
  }
  
  if (args[0] === '--verify-all') {
    verifyAll(patterns);
    return;
  }
  
  if (args[0] === '--export') {
    exportToCSV(patterns);
    return;
  }
  
  if (args[0] === '--help') {
    console.log(`
Pattern Review Tool
═══════════════════

Commands:
  (no args)              Show unverified patterns needing review
  --all                  Show all learned patterns
  --recent [days]        Show patterns from last N days (default: 7)
  --stats                Show statistics
  --verify <#>           Mark pattern # as verified (correct)
  --reject <#>           Delete pattern # (incorrect, will re-learn)
  --fix <#> <type>       Correct pattern # to new field type
  --verify-all           Mark ALL unverified as verified
  --export               Export all patterns to CSV
  --help                 Show this help

Examples:
  node review-patterns.js                    # Review unverified
  node review-patterns.js --verify 3         # Verify pattern #3
  node review-patterns.js --fix 2 phone_type # Fix pattern #2's type
  node review-patterns.js --recent 1         # Patterns from today
`);
    return;
  }
  
  console.error(`Unknown command: ${args[0]}`);
  console.error('Use --help for available commands');
}

main();
