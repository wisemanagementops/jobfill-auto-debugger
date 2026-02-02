// Code Patcher - Applies fixes to auto-debugger source files
import { readFile, writeFile, copyFile } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import config from './config.js';

export class CodePatcher {
  constructor() {
    this.appliedPatches = [];
    this.backups = new Map();
  }

  async applyFixes(fixes) {
    const results = [];
    
    for (const fix of fixes) {
      console.log(`\n🔧 Applying fix to ${fix.file}...`);
      console.log(`   Description: ${fix.description}`);
      
      const result = await this.applyFix(fix);
      results.push(result);
      
      if (result.success) {
        console.log(`   ✅ Fix applied successfully`);
        this.appliedPatches.push(fix);
      } else {
        console.log(`   ❌ Fix failed: ${result.error}`);
      }
    }
    
    return results;
  }

  async applyFix(fix) {
    // Use srcDir for auto-debugger files
    const filepath = join(config.srcDir, fix.file);
    
    // Validate file exists
    if (!existsSync(filepath)) {
      return {
        success: false,
        file: fix.file,
        error: `File not found: ${filepath}`
      };
    }
    
    try {
      // Read current file content
      const content = await readFile(filepath, 'utf-8');
      
      // Create backup if not already backed up
      if (!this.backups.has(filepath)) {
        await this.createBackup(filepath);
      }
      
      // Check if search string exists
      if (!content.includes(fix.search)) {
        // Try to find similar content for debugging
        const lines = fix.search.split('\n');
        const firstLine = lines[0].trim();
        
        if (content.includes(firstLine)) {
          return {
            success: false,
            file: fix.file,
            error: `Search string not found exactly. First line found but full match failed. Check whitespace/indentation.`,
            hint: `First line "${firstLine.substring(0, 50)}..." exists in file`
          };
        }
        
        return {
          success: false,
          file: fix.file,
          error: `Search string not found in file`,
          searchPreview: fix.search.substring(0, 100)
        };
      }
      
      // Check for multiple occurrences
      const occurrences = content.split(fix.search).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          file: fix.file,
          error: `Search string found ${occurrences} times. Must be unique.`
        };
      }
      
      // Apply the fix
      const newContent = content.replace(fix.search, fix.replace);
      
      // Validate the replacement was made
      if (newContent === content) {
        return {
          success: false,
          file: fix.file,
          error: 'Replacement resulted in no change'
        };
      }
      
      // Write the patched file
      await writeFile(filepath, newContent, 'utf-8');
      
      // Save patch for records
      await this.savePatch(fix);
      
      return {
        success: true,
        file: fix.file,
        description: fix.description,
        linesChanged: fix.replace.split('\n').length - fix.search.split('\n').length
      };
      
    } catch (error) {
      return {
        success: false,
        file: fix.file,
        error: error.message
      };
    }
  }

  async createBackup(filepath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(
      config.patchesDir, 
      'backups',
      `${basename(filepath)}.${timestamp}.backup`
    );
    
    // Ensure backup directory exists
    const backupDir = join(config.patchesDir, 'backups');
    const { mkdir } = await import('fs/promises');
    await mkdir(backupDir, { recursive: true });
    
    await copyFile(filepath, backupPath);
    this.backups.set(filepath, backupPath);
    
    console.log(`   📦 Backup created: ${basename(backupPath)}`);
    return backupPath;
  }

  async savePatch(fix) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const patchPath = join(
      config.patchesDir,
      `${basename(fix.file)}.${timestamp}.patch`
    );
    
    const patchContent = {
      timestamp: new Date().toISOString(),
      file: fix.file,
      description: fix.description,
      search: fix.search,
      replace: fix.replace
    };
    
    await writeFile(patchPath, JSON.stringify(patchContent, null, 2));
    return patchPath;
  }

  async revertAll() {
    console.log('\n🔄 Reverting all patches...');
    
    for (const [filepath, backupPath] of this.backups) {
      try {
        await copyFile(backupPath, filepath);
        console.log(`   ✅ Reverted: ${basename(filepath)}`);
      } catch (error) {
        console.log(`   ❌ Failed to revert ${basename(filepath)}: ${error.message}`);
      }
    }
    
    this.appliedPatches = [];
    console.log('✅ All patches reverted');
  }

  async revertFile(filename) {
    const filepath = join(config.extensionPath, filename);
    const backupPath = this.backups.get(filepath);
    
    if (!backupPath) {
      console.log(`No backup found for ${filename}`);
      return false;
    }
    
    try {
      await copyFile(backupPath, filepath);
      console.log(`✅ Reverted: ${filename}`);
      return true;
    } catch (error) {
      console.log(`❌ Failed to revert ${filename}: ${error.message}`);
      return false;
    }
  }

  getAppliedPatches() {
    return this.appliedPatches;
  }

  async validateSyntax(filepath) {
    // Simple syntax validation for JavaScript files
    try {
      const content = await readFile(filepath, 'utf-8');
      
      // Try to parse as module
      new Function(content);
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: error.message,
        line: error.lineNumber
      };
    }
  }
}

export default CodePatcher;
