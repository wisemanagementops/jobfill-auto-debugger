#!/usr/bin/env node
// Profile Setup - Interactive wizard to create your job application profile
// Usage: npm run setup

import readline from 'readline';
import { readFile, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '../profile.json');
const examplePath = join(__dirname, '../profile.example.json');

class ProfileSetup {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.profile = null;
  }

  async prompt(question, defaultValue = '') {
    const defaultText = defaultValue ? ` (${defaultValue})` : '';
    return new Promise(resolve => {
      this.rl.question(`${question}${defaultText}: `, answer => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async promptYesNo(question, defaultValue = true) {
    const defaultText = defaultValue ? '(Y/n)' : '(y/N)';
    const answer = await this.prompt(`${question} ${defaultText}`);
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
  }

  async promptSelect(question, options) {
    console.log(`\n${question}`);
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
    const answer = await this.prompt('Enter number');
    const index = parseInt(answer) - 1;
    return options[index] || options[0];
  }

  async loadExistingProfile() {
    if (existsSync(profilePath)) {
      try {
        this.profile = JSON.parse(await readFile(profilePath, 'utf-8'));
        console.log('📂 Loaded existing profile');
        return true;
      } catch (e) {
        console.log('⚠️ Could not load existing profile, starting fresh');
      }
    }
    
    // Load from example
    this.profile = JSON.parse(await readFile(examplePath, 'utf-8'));
    return false;
  }

  async run() {
    console.log('\n' + '='.repeat(60));
    console.log('🧑‍💼 JOBFILL PROFILE SETUP');
    console.log('='.repeat(60));
    console.log('This wizard will help you set up your job application profile.');
    console.log('Your data is stored locally in profile.json\n');

    const hasExisting = await this.loadExistingProfile();
    
    if (hasExisting) {
      const update = await this.promptYesNo('Update existing profile?', true);
      if (!update) {
        console.log('Profile unchanged.');
        this.rl.close();
        return;
      }
    }

    // Personal Information
    console.log('\n📋 PERSONAL INFORMATION');
    console.log('-'.repeat(40));
    
    this.profile.personal.firstName = await this.prompt(
      'First Name', this.profile.personal.firstName
    );
    this.profile.personal.lastName = await this.prompt(
      'Last Name', this.profile.personal.lastName
    );
    this.profile.personal.email = await this.prompt(
      'Email', this.profile.personal.email
    );
    this.profile.personal.phone = await this.prompt(
      'Phone (e.g., 555-123-4567)', this.profile.personal.phone
    );
    this.profile.personal.linkedIn = await this.prompt(
      'LinkedIn URL (optional)', this.profile.personal.linkedIn
    );

    // Address
    console.log('\n🏠 ADDRESS');
    console.log('-'.repeat(40));
    
    this.profile.address.addressLine1 = await this.prompt(
      'Address Line 1', this.profile.address.addressLine1
    );
    this.profile.address.addressLine2 = await this.prompt(
      'Address Line 2 (optional)', this.profile.address.addressLine2
    );
    this.profile.address.city = await this.prompt(
      'City', this.profile.address.city
    );
    this.profile.address.state = await this.prompt(
      'State (e.g., OR, CA, TX)', this.profile.address.state
    );
    this.profile.address.zipCode = await this.prompt(
      'ZIP Code', this.profile.address.zipCode
    );
    this.profile.address.country = await this.prompt(
      'Country', this.profile.address.country || 'United States'
    );

    // Work Authorization
    console.log('\n🛂 WORK AUTHORIZATION');
    console.log('-'.repeat(40));
    
    this.profile.workAuthorization.authorizedToWork = await this.promptYesNo(
      'Are you authorized to work in the US?',
      this.profile.workAuthorization.authorizedToWork
    );
    
    this.profile.workAuthorization.requiresSponsorship = await this.promptYesNo(
      'Do you now or will you require sponsorship?',
      this.profile.workAuthorization.requiresSponsorship
    );
    
    this.profile.workAuthorization.citizenshipStatus = await this.promptSelect(
      'Citizenship Status:', [
        'US Citizen',
        'Permanent Resident (Green Card)',
        'Work Visa (H1B, L1, etc.)',
        'Student Visa (F1, OPT)',
        'Other'
      ]
    );

    // Export Control
    console.log('\n🔒 EXPORT CONTROL (ITAR/EAR)');
    console.log('-'.repeat(40));
    console.log('Some jobs require access to export-controlled information.');
    
    this.profile.exportControl.isUSPerson = await this.promptYesNo(
      'Are you a "US Person" (citizen, permanent resident, or asylee)?',
      this.profile.exportControl.isUSPerson
    );

    // Demographics (EEO)
    console.log('\n📊 DEMOGRAPHICS (Voluntary EEO)');
    console.log('-'.repeat(40));
    console.log('This information is voluntary and used for reporting only.');
    
    const fillDemographics = await this.promptYesNo('Fill in demographics?', true);
    
    if (fillDemographics) {
      this.profile.demographics.gender = await this.promptSelect(
        'Gender:', ['Male', 'Female', 'Non-binary', 'Prefer not to say']
      );
      
      this.profile.demographics.race = await this.promptSelect(
        'Race/Ethnicity:', [
          'Asian',
          'Black/African American', 
          'Hispanic/Latino',
          'White',
          'American Indian/Alaska Native',
          'Native Hawaiian/Pacific Islander',
          'Two or More Races',
          'Prefer not to say'
        ]
      );
      
      this.profile.demographics.veteranStatus = await this.promptSelect(
        'Veteran Status:', [
          'Not a Veteran',
          'Veteran',
          'Protected Veteran',
          'Prefer not to say'
        ]
      );
      
      this.profile.demographics.disabilityStatus = await this.promptSelect(
        'Disability Status:', [
          'No, I don\'t have a disability',
          'Yes, I have a disability',
          'Prefer not to say'
        ]
      );
    }

    // Employment
    console.log('\n💼 EMPLOYMENT');
    console.log('-'.repeat(40));
    
    this.profile.employment.yearsOfExperience = await this.prompt(
      'Years of Experience', this.profile.employment.yearsOfExperience
    );
    this.profile.employment.currentTitle = await this.prompt(
      'Current Job Title', this.profile.employment.currentTitle
    );
    this.profile.employment.currentEmployer = await this.prompt(
      'Current Employer', this.profile.employment.currentEmployer
    );

    // Education
    console.log('\n🎓 EDUCATION');
    console.log('-'.repeat(40));
    
    this.profile.education.highestDegree = await this.promptSelect(
      'Highest Degree:', [
        'High School',
        'Associate\'s',
        'Bachelor\'s',
        'Master\'s',
        'PhD/Doctorate',
        'Professional (JD, MD, etc.)'
      ]
    );
    this.profile.education.university = await this.prompt(
      'University/College', this.profile.education.university
    );
    this.profile.education.major = await this.prompt(
      'Major/Field of Study', this.profile.education.major
    );
    this.profile.education.graduationYear = await this.prompt(
      'Graduation Year', this.profile.education.graduationYear
    );

    // Resume
    console.log('\n📄 DOCUMENTS');
    console.log('-'.repeat(40));
    
    this.profile.documents.resumePath = await this.prompt(
      'Path to Resume (PDF)', this.profile.documents.resumePath
    );
    this.profile.documents.coverLetterPath = await this.prompt(
      'Path to Cover Letter (optional)', this.profile.documents.coverLetterPath
    );

    // Save
    console.log('\n💾 SAVING PROFILE...');
    await writeFile(profilePath, JSON.stringify(this.profile, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Profile saved to profile.json');
    console.log('='.repeat(60));
    console.log('\nYou can now run:');
    console.log('  npm run assisted <url>  - Interactive testing');
    console.log('  npm start -- --url <url> - Automated testing');
    
    this.rl.close();
  }
}

// Run
const setup = new ProfileSetup();
setup.run().catch(console.error);
