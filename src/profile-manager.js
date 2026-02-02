// Profile Manager - Collects and stores user data for form filling
import readline from 'readline';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROFILE_PATH = join(__dirname, '../profile.json');

// Default profile structure with all common fields
const DEFAULT_PROFILE = {
  // Personal Information
  personal: {
    firstName: '',
    lastName: '',
    middleName: '',
    preferredName: '',
    email: '',
    phone: '',
    linkedIn: '',
    website: '',
  },
  
  // Address
  address: {
    line1: '',
    line2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'United States',
  },
  
  // Work Authorization
  workAuth: {
    authorizedToWork: true,           // Are you authorized to work in the US?
    requiresSponsorship: false,        // Will you require sponsorship now or in future?
    visaStatus: '',                    // H1B, Green Card, Citizen, etc.
    exportControlCompliant: true,      // Can you comply with export control laws?
  },
  
  // EEO / Voluntary Self-Identification
  eeo: {
    gender: '',                        // Male, Female, Non-binary, Prefer not to say
    race: '',                          // Asian, White, Black, Hispanic, etc.
    ethnicity: '',                     // Hispanic/Latino or Not Hispanic/Latino
    veteranStatus: '',                 // Not a Veteran, Protected Veteran, etc.
    disabilityStatus: '',              // Yes, No, Prefer not to say
  },
  
  // Employment Preferences
  employment: {
    desiredSalary: '',
    salaryFlexible: true,
    availableStartDate: '',            // Immediately, 2 weeks, specific date
    willingToRelocate: false,
    willingToTravel: true,             // Willing to travel for work
    yearsOfExperience: '',
  },
  
  // Resume & Documents
  documents: {
    resumePath: '',                    // Path to resume file
    coverLetterPath: '',               // Path to cover letter (optional)
  },
  
  // Referral
  referral: {
    source: 'LinkedIn',                // How did you hear about us?
    referrerName: '',                  // Employee referral name
    referrerEmail: '',
  },
  
  // Education (most recent)
  education: {
    degree: '',                        // Bachelor's, Master's, PhD, etc.
    fieldOfStudy: '',
    school: '',
    graduationYear: '',
    gpa: '',
  },
  
  // Additional common questions
  additional: {
    over18: true,
    criminalHistory: false,            // Have you been convicted of a felony?
    previouslyApplied: false,          // Have you previously applied to this company?
    previouslyEmployed: false,         // Have you previously worked at this company?
    currentlyEmployed: true,           // Are you currently employed?
    canContactCurrentEmployer: false,  // May we contact your current employer?
    
    // Agreements & Legal
    agreeToTerms: true,                // Agreement to terms and conditions
    hasRestrictiveAgreement: false,    // Non-compete, non-solicitation agreements
    hasRelativeAtCompany: false,       // Do you have a relative at this company?
    consentBackgroundCheck: true,      // Consent to background check
    consentDrugTest: true,             // Consent to drug test
  },
  
  // Metadata
  meta: {
    createdAt: '',
    updatedAt: '',
    version: '1.1',
  }
};

export class ProfileManager {
  constructor() {
    this.profile = null;
    this.rl = null;
  }

  async initialize() {
    if (existsSync(PROFILE_PATH)) {
      try {
        this.profile = JSON.parse(await readFile(PROFILE_PATH, 'utf-8'));
        console.log(`✅ Profile loaded: ${this.profile.personal.firstName} ${this.profile.personal.lastName}`);
        return this.profile;
      } catch (error) {
        console.log('⚠️ Error loading profile, will create new one');
      }
    }
    return null;
  }

  async prompt(question, defaultValue = '') {
    return new Promise(resolve => {
      const displayDefault = defaultValue ? ` [${defaultValue}]` : '';
      this.rl.question(`${question}${displayDefault}: `, answer => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async promptYesNo(question, defaultValue = true) {
    const defaultStr = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.prompt(`${question} (${defaultStr})`, '');
    if (answer === '') return defaultValue;
    return answer.toLowerCase().startsWith('y');
  }

  async promptChoice(question, choices, defaultIndex = 0) {
    console.log(`\n${question}`);
    choices.forEach((choice, i) => {
      const marker = i === defaultIndex ? '>' : ' ';
      console.log(`  ${marker} ${i + 1}. ${choice}`);
    });
    
    const answer = await this.prompt('Enter number', String(defaultIndex + 1));
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < choices.length) {
      return choices[index];
    }
    return choices[defaultIndex];
  }

  async runSetupWizard() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n' + '='.repeat(60));
    console.log('📝 JOBFILL PROFILE SETUP WIZARD');
    console.log('='.repeat(60));
    console.log('This information will be used to fill job applications.');
    console.log('All data is stored locally in profile.json\n');

    const profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));

    // Personal Information
    console.log('\n--- PERSONAL INFORMATION ---');
    profile.personal.firstName = await this.prompt('First Name');
    profile.personal.lastName = await this.prompt('Last Name');
    profile.personal.middleName = await this.prompt('Middle Name (optional)');
    profile.personal.email = await this.prompt('Email');
    profile.personal.phone = await this.prompt('Phone (e.g., (555) 123-4567)');
    profile.personal.linkedIn = await this.prompt('LinkedIn URL (optional)');

    // Address
    console.log('\n--- ADDRESS ---');
    profile.address.line1 = await this.prompt('Address Line 1');
    profile.address.line2 = await this.prompt('Address Line 2 (apt, suite, etc.)');
    profile.address.city = await this.prompt('City');
    profile.address.state = await this.prompt('State (e.g., OR, CA, NY)');
    profile.address.zipCode = await this.prompt('ZIP Code');
    profile.address.country = await this.prompt('Country', 'United States');

    // Work Authorization
    console.log('\n--- WORK AUTHORIZATION ---');
    profile.workAuth.authorizedToWork = await this.promptYesNo(
      'Are you legally authorized to work in the United States?', true
    );
    profile.workAuth.requiresSponsorship = await this.promptYesNo(
      'Do you now or will you in the future require sponsorship?', false
    );
    
    if (profile.workAuth.requiresSponsorship) {
      profile.workAuth.visaStatus = await this.promptChoice(
        'Current visa status:',
        ['H1B', 'F1/OPT', 'L1', 'TN', 'Green Card', 'US Citizen', 'Other'],
        0
      );
    } else {
      profile.workAuth.visaStatus = await this.promptChoice(
        'Current status:',
        ['US Citizen', 'Green Card/Permanent Resident', 'Other'],
        0
      );
    }
    
    profile.workAuth.exportControlCompliant = await this.promptYesNo(
      'Can you comply with U.S. export control laws (ITAR/EAR)?', true
    );

    // EEO / Voluntary Self-Identification
    console.log('\n--- VOLUNTARY SELF-IDENTIFICATION (EEO) ---');
    console.log('(This information is used for diversity reporting and is optional)');
    
    profile.eeo.gender = await this.promptChoice(
      'Gender:',
      ['Male', 'Female', 'Non-binary', 'Prefer not to say'],
      0
    );
    
    profile.eeo.race = await this.promptChoice(
      'Race/Ethnicity:',
      [
        'American Indian or Alaska Native',
        'Asian',
        'Black or African American',
        'Hispanic or Latino',
        'Native Hawaiian or Other Pacific Islander',
        'White',
        'Two or More Races',
        'Prefer not to say'
      ],
      1
    );
    
    profile.eeo.veteranStatus = await this.promptChoice(
      'Veteran Status:',
      [
        'I am not a veteran',
        'I am a veteran',
        'I am a protected veteran',
        'Prefer not to say'
      ],
      0
    );
    
    profile.eeo.disabilityStatus = await this.promptChoice(
      'Disability Status:',
      [
        'No, I do not have a disability',
        'Yes, I have a disability',
        'Prefer not to say'
      ],
      0
    );

    // Employment Preferences
    console.log('\n--- EMPLOYMENT PREFERENCES ---');
    profile.employment.yearsOfExperience = await this.prompt('Total years of experience');
    profile.employment.desiredSalary = await this.prompt('Desired salary (optional, e.g., $120,000)');
    profile.employment.availableStartDate = await this.prompt('Available start date (e.g., Immediately, 2 weeks)');
    profile.employment.willingToRelocate = await this.promptYesNo('Willing to relocate?', false);

    // Resume
    console.log('\n--- DOCUMENTS ---');
    profile.documents.resumePath = await this.prompt(
      'Path to resume file (PDF recommended)\n  Example: /Users/you/Documents/resume.pdf\n  Resume path'
    );

    // Education
    console.log('\n--- EDUCATION (Most Recent) ---');
    profile.education.degree = await this.promptChoice(
      'Highest degree:',
      ["High School", "Associate's", "Bachelor's", "Master's", "PhD", "Other"],
      2
    );
    profile.education.fieldOfStudy = await this.prompt('Field of study (e.g., Computer Science)');
    profile.education.school = await this.prompt('School/University name');
    profile.education.graduationYear = await this.prompt('Graduation year');

    // Additional
    console.log('\n--- ADDITIONAL QUESTIONS ---');
    profile.additional.over18 = await this.promptYesNo('Are you 18 years or older?', true);
    profile.additional.criminalHistory = await this.promptYesNo(
      'Have you ever been convicted of a felony?', false
    );
    profile.additional.previouslyEmployed = await this.promptYesNo(
      'Have you previously worked at any company you\'re applying to?', false
    );
    profile.additional.currentlyEmployed = await this.promptYesNo(
      'Are you currently employed?', true
    );
    profile.additional.canContactCurrentEmployer = await this.promptYesNo(
      'May employers contact your current employer?', false
    );
    
    // Agreements & Legal
    console.log('\n--- LEGAL & AGREEMENTS ---');
    profile.additional.hasRestrictiveAgreement = await this.promptYesNo(
      'Are you bound by any non-compete or non-solicitation agreements?', false
    );
    profile.additional.hasRelativeAtCompany = await this.promptYesNo(
      'Do you have any relatives working at companies you typically apply to?', false
    );
    profile.additional.consentBackgroundCheck = await this.promptYesNo(
      'Do you consent to background checks?', true
    );
    profile.additional.consentDrugTest = await this.promptYesNo(
      'Do you consent to drug testing if required?', true
    );
    profile.additional.agreeToTerms = true;  // Always true for applications
    
    // Employment preferences additions
    console.log('\n--- WORK PREFERENCES ---');
    profile.employment.willingToTravel = await this.promptYesNo(
      'Are you willing to travel for work?', true
    );
    
    // Referral source
    profile.referral.source = await this.promptChoice(
      'How do you typically hear about job opportunities?',
      ['LinkedIn', 'Indeed', 'Company Website', 'Employee Referral', 'Job Board', 'Recruiter', 'Other'],
      0
    );

    // Metadata
    profile.meta.createdAt = new Date().toISOString();
    profile.meta.updatedAt = new Date().toISOString();

    // Save profile
    this.profile = profile;
    await this.saveProfile();

    this.rl.close();

    // Display summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ PROFILE CREATED SUCCESSFULLY');
    console.log('='.repeat(60));
    this.displayProfile();

    return profile;
  }

  async saveProfile() {
    this.profile.meta.updatedAt = new Date().toISOString();
    await writeFile(PROFILE_PATH, JSON.stringify(this.profile, null, 2));
    console.log(`\n💾 Profile saved to: ${PROFILE_PATH}`);
  }

  displayProfile() {
    const p = this.profile;
    console.log(`
Name: ${p.personal.firstName} ${p.personal.lastName}
Email: ${p.personal.email}
Phone: ${p.personal.phone}
Address: ${p.address.line1}, ${p.address.city}, ${p.address.state} ${p.address.zipCode}
Work Auth: ${p.workAuth.authorizedToWork ? 'Yes' : 'No'}, Sponsorship: ${p.workAuth.requiresSponsorship ? 'Yes' : 'No'}
Experience: ${p.employment.yearsOfExperience} years
Education: ${p.education.degree} in ${p.education.fieldOfStudy}
Resume: ${p.documents.resumePath || 'Not set'}
    `);
  }

  // Convert profile to the format JobFill extension expects
  toExtensionFormat() {
    const p = this.profile;
    
    return {
      // Direct mappings (Phase 1)
      email: p.personal.email,
      firstName: p.personal.firstName,
      lastName: p.personal.lastName,
      middleName: p.personal.middleName,
      fullName: `${p.personal.firstName} ${p.personal.lastName}`,
      phone: p.personal.phone,
      linkedIn: p.personal.linkedIn,
      website: p.personal.website,
      
      // Address
      address: p.address.line1,
      addressLine2: p.address.line2,
      city: p.address.city,
      state: p.address.state,
      zipCode: p.address.zipCode,
      country: p.address.country,
      
      // Work auth - the extension uses boolean answers
      workAuthorization: p.workAuth.authorizedToWork,
      requiresSponsorship: p.workAuth.requiresSponsorship,
      visaStatus: p.workAuth.visaStatus,
      
      // EEO
      gender: p.eeo.gender,
      ethnicity: p.eeo.race,
      veteranStatus: p.eeo.veteranStatus,
      disabilityStatus: p.eeo.disabilityStatus,
      
      // Employment
      yearsExperience: p.employment.yearsOfExperience,
      desiredSalary: p.employment.desiredSalary,
      startDate: p.employment.availableStartDate,
      willingToRelocate: p.employment.willingToRelocate,
      
      // Education
      degree: p.education.degree,
      fieldOfStudy: p.education.fieldOfStudy,
      school: p.education.school,
      graduationYear: p.education.graduationYear,
      
      // Additional
      over18: p.additional.over18,
      
      // Resume
      resumePath: p.documents.resumePath,
    };
  }

  getProfile() {
    return this.profile;
  }

  async editField(section, field) {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }

    const currentValue = this.profile[section]?.[field];
    const newValue = await this.prompt(`${section}.${field}`, currentValue);
    
    if (this.profile[section]) {
      this.profile[section][field] = newValue;
      await this.saveProfile();
    }

    this.rl.close();
    this.rl = null;
  }
}

// CLI for standalone use
async function main() {
  const args = process.argv.slice(2);
  const manager = new ProfileManager();
  
  if (args[0] === 'setup' || args[0] === '--setup') {
    await manager.runSetupWizard();
  } else if (args[0] === 'show' || args[0] === '--show') {
    const profile = await manager.initialize();
    if (profile) {
      manager.displayProfile();
    } else {
      console.log('No profile found. Run: node profile-manager.js setup');
    }
  } else if (args[0] === 'edit' && args[1] && args[2]) {
    await manager.initialize();
    await manager.editField(args[1], args[2]);
  } else {
    console.log(`
JobFill Profile Manager

Usage:
  node profile-manager.js setup    Run the setup wizard
  node profile-manager.js show     Display current profile
  node profile-manager.js edit <section> <field>   Edit a specific field

Examples:
  node profile-manager.js setup
  node profile-manager.js show
  node profile-manager.js edit personal phone
    `);
  }
}

export default ProfileManager;

// Run if called directly
const isMainModule = process.argv[1]?.includes('profile-manager');
if (isMainModule) {
  main().catch(console.error);
}
