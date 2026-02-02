// ============================================
// TEST SCRIPT FOR HYBRID FIELD CLASSIFIER v3.0
// Tests accuracy-optimized models:
// - Zero-shot: MoritzLaurer/deberta-v3-large-zeroshot-v2.0
// - Embeddings: Xenova/bge-m3
// ============================================

import HybridFieldClassifier from './hybrid-field-classifier.js';

async function testClassifier() {
  console.log('='.repeat(60));
  console.log('HYBRID FIELD CLASSIFIER v3.0 - ACCURACY TEST');
  console.log('='.repeat(60));
  console.log('');
  
  // Create classifier with accuracy-optimized settings
  const classifier = new HybridFieldClassifier({
    confidenceThreshold: 0.45,
    similarityThreshold: 0.6,
  });

  // Print model info
  console.log('Configuration:');
  const info = classifier.getModelInfo();
  console.log(`  Zero-shot model: ${info.zeroShotModel}`);
  console.log(`  Embedding model: ${info.embeddingModel}`);
  console.log(`  Zero-shot threshold: ${info.zeroShotThreshold}`);
  console.log(`  Similarity threshold: ${info.similarityThreshold}`);
  console.log('');

  // Load models
  console.log('Loading models (this may take 10-15 seconds on first run)...');
  const loadStart = Date.now();
  await classifier.loadModels();
  const loadTime = ((Date.now() - loadStart) / 1000).toFixed(1);
  console.log(`Models loaded in ${loadTime}s`);
  console.log('');

  // Test fields - various phrasings to test accuracy
  const testFields = [
    // Work Authorization - Different phrasings
    {
      id: 'work-auth-1',
      labelText: 'Are you legally authorized to work in the United States?',
      type: 'radio',
      expected: 'work_authorization',
    },
    {
      id: 'work-auth-2',
      labelText: 'Do you have the legal right to work in this country?',
      type: 'radio',
      expected: 'work_authorization',
    },
    {
      id: 'work-auth-3',
      labelText: 'Employment eligibility verification',
      type: 'radio',
      expected: 'work_authorization',
    },
    
    // Visa Sponsorship - Different phrasings
    {
      id: 'sponsor-1',
      labelText: 'Will you now or in the future require sponsorship for employment visa status?',
      type: 'radio',
      expected: 'visa_sponsorship',
    },
    {
      id: 'sponsor-2',
      labelText: 'Do you need H-1B sponsorship?',
      type: 'radio',
      expected: 'visa_sponsorship',
    },
    {
      id: 'sponsor-3',
      labelText: 'Immigration sponsorship required?',
      type: 'dropdown',
      expected: 'visa_sponsorship',
    },
    
    // Previous Employee
    {
      id: 'prev-emp-1',
      labelText: 'Have you previously worked at this company?',
      type: 'radio',
      expected: 'previous_employee',
    },
    {
      id: 'prev-emp-2',
      labelText: 'Are you a former employee?',
      type: 'radio',
      expected: 'previous_employee',
    },
    
    // Personal Info
    {
      id: 'first-name',
      labelText: 'First Name',
      type: 'text',
      expected: 'first_name',
    },
    {
      id: 'last-name',
      labelText: 'Family Name',
      type: 'text',
      expected: 'last_name',
    },
    {
      id: 'email',
      labelText: 'Email Address',
      type: 'text',
      expected: 'email',
    },
    
    // Referral Source
    {
      id: 'source-1',
      labelText: 'How did you hear about this position?',
      type: 'dropdown',
      expected: 'referral_source',
    },
    {
      id: 'source-2',
      labelText: 'Where did you learn about this opportunity?',
      type: 'dropdown',
      expected: 'referral_source',
    },
    
    // EEO Fields
    {
      id: 'gender',
      labelText: 'Gender Identity',
      type: 'dropdown',
      expected: 'gender',
    },
    {
      id: 'ethnicity',
      labelText: 'Race/Ethnicity',
      type: 'dropdown',
      expected: 'ethnicity',
    },
    {
      id: 'veteran',
      labelText: 'Protected Veteran Status',
      type: 'dropdown',
      expected: 'veteran_status',
    },
    {
      id: 'disability',
      labelText: 'Do you have a disability?',
      type: 'radio',
      expected: 'disability_status',
    },
    
    // LinkedIn
    {
      id: 'linkedin',
      labelText: 'LinkedIn Profile URL',
      type: 'text',
      expected: 'linkedin',
    },
  ];

  // Run classification
  console.log('='.repeat(60));
  console.log('CLASSIFICATION RESULTS');
  console.log('='.repeat(60));
  console.log('');

  let correct = 0;
  let total = testFields.length;
  const results = [];

  for (const field of testFields) {
    const startTime = Date.now();
    const result = await classifier.classifyField(field);
    const inferenceTime = Date.now() - startTime;
    
    // Check if classification matches expected category
    const matchedCategory = result.matchedCategory || 
      classifier.categoryToLabel && getKeyFromLabel(result.label);
    
    const isCorrect = matchedCategory === field.expected || 
      labelMatchesExpected(result.label, field.expected);
    
    if (isCorrect) correct++;
    
    const status = isCorrect ? '✅' : '❌';
    
    console.log(`${status} Field: "${field.labelText}"`);
    console.log(`   Method: ${result.method} | Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`   Label: ${result.label?.substring(0, 60)}...`);
    console.log(`   Expected: ${field.expected} | Time: ${inferenceTime}ms`);
    console.log('');
    
    results.push({
      field: field.labelText,
      expected: field.expected,
      method: result.method,
      confidence: result.confidence,
      correct: isCorrect,
      inferenceTime,
    });
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Accuracy: ${correct}/${total} (${((correct/total)*100).toFixed(1)}%)`);
  console.log('');
  
  const zeroShotCount = results.filter(r => r.method === 'zero-shot').length;
  const similarityCount = results.filter(r => r.method === 'semantic-similarity').length;
  const lowConfCount = results.filter(r => r.method === 'zero-shot-low-confidence').length;
  
  console.log('Classification Methods Used:');
  console.log(`  Zero-shot (high confidence): ${zeroShotCount}`);
  console.log(`  Semantic similarity (fallback): ${similarityCount}`);
  console.log(`  Zero-shot (low confidence): ${lowConfCount}`);
  console.log('');
  
  const avgTime = results.reduce((sum, r) => sum + r.inferenceTime, 0) / results.length;
  console.log(`Average inference time: ${avgTime.toFixed(0)}ms per field`);
  console.log('');

  // Test with profile
  console.log('='.repeat(60));
  console.log('PROFILE VALUE EXTRACTION TEST');
  console.log('='.repeat(60));
  console.log('');
  
  const profile = {
    personal: {
      firstName: 'Bhanu',
      lastName: 'Kumar',
      email: 'bhanu@example.com',
      phone: '(503) 555-1234',
      linkedIn: 'https://linkedin.com/in/bhanukumar',
    },
    address: {
      line1: '123 Main St',
      city: 'Portland',
      state: 'Oregon',
      zipCode: '97201',
    },
    workAuth: {
      authorizedToWork: true,
      requiresSponsorship: false,
      visaStatus: 'Green Card',
    },
    education: {
      school: 'Oregon State University',
      degree: "Master's",
      fieldOfStudy: 'Electrical Engineering',
      graduationYear: '2018',
    },
    eeo: {
      gender: 'Male',
      race: 'Asian',
      veteranStatus: 'Not a veteran',
      disabilityStatus: 'No',
    },
    referral: {
      source: 'LinkedIn',
    },
    additional: {
      previouslyEmployed: false,
    },
  };
  
  // Get values for a few classified fields
  const testValueFields = [
    { labelText: 'First Name', type: 'text' },
    { labelText: 'Are you authorized to work in the US?', type: 'radio' },
    { labelText: 'Will you require visa sponsorship?', type: 'radio' },
    { labelText: 'Gender', type: 'dropdown' },
  ];
  
  for (const field of testValueFields) {
    const classification = await classifier.classifyField(field);
    const valueResult = classifier.getValueForField({ classification }, profile);
    
    console.log(`Field: "${field.labelText}"`);
    console.log(`  → Label: ${classification.label?.substring(0, 50)}...`);
    console.log(`  → Profile key: ${valueResult?.key}`);
    console.log(`  → Value: ${valueResult?.value}`);
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

// Helper function to match label to expected category
function labelMatchesExpected(label, expected) {
  if (!label) return false;
  
  const labelLower = label.toLowerCase();
  
  const mappings = {
    'work_authorization': ['legally work', 'authorized to work', 'legal right to work'],
    'visa_sponsorship': ['sponsorship', 'visa'],
    'previous_employee': ['previously worked', 'former employee'],
    'first_name': ['first name', 'given name'],
    'last_name': ['last name', 'family name', 'surname'],
    'email': ['email'],
    'phone': ['phone'],
    'referral_source': ['hear about', 'learn about', 'source'],
    'gender': ['gender'],
    'ethnicity': ['race', 'ethnicity'],
    'veteran_status': ['veteran', 'military'],
    'disability_status': ['disability'],
    'linkedin': ['linkedin'],
  };
  
  const keywords = mappings[expected] || [];
  return keywords.some(kw => labelLower.includes(kw));
}

function getKeyFromLabel(label) {
  if (!label) return null;
  const labelLower = label.toLowerCase();
  
  if (labelLower.includes('legally work') || labelLower.includes('authorized to work')) return 'work_authorization';
  if (labelLower.includes('sponsorship')) return 'visa_sponsorship';
  if (labelLower.includes('previously worked')) return 'previous_employee';
  if (labelLower.includes('first name')) return 'first_name';
  if (labelLower.includes('last name') || labelLower.includes('family name')) return 'last_name';
  if (labelLower.includes('email')) return 'email';
  if (labelLower.includes('phone')) return 'phone';
  if (labelLower.includes('hear about')) return 'referral_source';
  if (labelLower.includes('gender')) return 'gender';
  if (labelLower.includes('race') || labelLower.includes('ethnicity')) return 'ethnicity';
  if (labelLower.includes('veteran')) return 'veteran_status';
  if (labelLower.includes('disability')) return 'disability_status';
  if (labelLower.includes('linkedin')) return 'linkedin';
  
  return null;
}

// Run tests
testClassifier().catch(console.error);
