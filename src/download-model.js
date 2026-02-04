// ============================================
// MODEL DOWNLOADER v2.0
// Downloads both models for hybrid classification:
//   1. MoritzLaurer/deberta-v3-large-zeroshot-v2.0 (Zero-shot, 435M params)
//   2. Xenova/bge-m3 (Embeddings, 568M params)
// 
// Run: node src/download-model.js
// ============================================

import { pipeline, env } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

// Set explicit cache directory so we know where it goes
const CACHE_DIR = path.join(process.cwd(), 'models');
env.cacheDir = CACHE_DIR;

// Disable local model check to force download
env.allowLocalModels = false;

// Model configurations
const MODELS = {
  zeroShot: {
    name: 'MoritzLaurer/deberta-v3-large-zeroshot-v2.0',
    task: 'zero-shot-classification',
    description: 'Zero-shot NLI classification (435M params)',
    expectedSize: '~1.7 GB',
    quantized: false,  // Full precision for maximum accuracy
  },
  embedding: {
    name: 'Xenova/bge-m3',
    task: 'feature-extraction',
    description: 'BGE-M3 embeddings (568M params, MTEB ~65)',
    expectedSize: '~2.2 GB',
    dtype: 'fp16',  // Half precision for balance of accuracy and memory
  },
};

// Fallback models if primary models fail
const FALLBACK_MODELS = {
  zeroShot: {
    name: 'Xenova/nli-deberta-v3-small',
    task: 'zero-shot-classification',
    description: 'Fallback: DeBERTa-v3-small (142M params)',
    expectedSize: '~570 MB',
    quantized: true,
  },
  embedding: {
    name: 'Xenova/bge-large-en-v1.5',
    task: 'feature-extraction',
    description: 'Fallback: BGE-large (335M params)',
    expectedSize: '~1.3 GB',
    quantized: true,
  },
};

async function downloadModel(modelConfig, modelType) {
  console.log(`\n📦 Model: ${modelConfig.name}`);
  console.log(`📋 ${modelConfig.description}`);
  console.log(`📊 Expected size: ${modelConfig.expectedSize}\n`);
  
  const startTime = Date.now();
  let lastProgress = 0;
  let lastFile = '';
  
  const options = {
    progress_callback: (progress) => {
      if (progress.status === 'downloading') {
        const file = progress.file || 'unknown';
        const loaded = progress.loaded || 0;
        const total = progress.total || 0;
        
        if (file !== lastFile) {
          if (lastFile) console.log('');  // New line for new file
          lastFile = file;
          lastProgress = 0;
        }
        
        if (total > 0) {
          const pct = Math.round((loaded / total) * 100);
          if (pct > lastProgress || pct === 100) {
            const loadedMB = (loaded / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r⬇️  ${file}: ${pct}% (${loadedMB}MB / ${totalMB}MB)    `);
            lastProgress = pct;
          }
        } else {
          process.stdout.write(`\r⬇️  Downloading ${file}...    `);
        }
      } else if (progress.status === 'ready') {
        console.log(`\n✅ ${progress.file || 'File'} ready`);
        lastProgress = 0;
        lastFile = '';
      }
    }
  };
  
  // Add model-specific options
  if (modelConfig.quantized !== undefined) {
    options.quantized = modelConfig.quantized;
  }
  if (modelConfig.dtype) {
    options.dtype = modelConfig.dtype;
  }
  
  const model = await pipeline(modelConfig.task, modelConfig.name, options);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  Downloaded in ${elapsed} seconds`);
  
  return model;
}

async function testZeroShotModel(classifier) {
  console.log('\n🧪 Testing zero-shot model...');
  
  const tests = [
    {
      input: 'Form field: Are you legally authorized to work in the United States?',
      labels: [
        "whether the applicant can legally work in this country without sponsorship",
        "whether the applicant will need visa sponsorship",
        "the applicant's first name"
      ],
      expected: 'work'
    },
    {
      input: 'Form field: First Name',
      labels: [
        "the applicant's first name",
        "the applicant's last name",
        "an email address"
      ],
      expected: 'first name'
    },
    {
      input: 'Form field: Will you now or in the future require sponsorship?',
      labels: [
        "whether the applicant will need visa sponsorship now or in the future",
        "whether the applicant can legally work in this country",
        "the applicant's first name"
      ],
      expected: 'sponsorship'
    }
  ];
  
  let passed = 0;
  for (const test of tests) {
    const result = await classifier(test.input, test.labels, {
      hypothesis_template: 'This form field asks for {}',
      multi_label: false
    });
    
    const isCorrect = result.labels[0].toLowerCase().includes(test.expected);
    console.log(`${isCorrect ? '✅' : '❌'} "${test.input.substring(0, 50)}..." → ${result.labels[0].substring(0, 40)}... (${(result.scores[0] * 100).toFixed(1)}%)`);
    if (isCorrect) passed++;
  }
  
  return passed === tests.length;
}

async function testEmbeddingModel(extractor) {
  console.log('\n🧪 Testing embedding model...');
  
  // Test embedding generation
  const testTexts = [
    'authorized to work',
    'legally authorized to work in the United States',
    'first name'
  ];
  
  try {
    const embeddings = await extractor(testTexts, { pooling: 'cls', normalize: true });
    
    // Calculate cosine similarity between first two (should be high)
    const emb1 = Array.from(embeddings[0].data);
    const emb2 = Array.from(embeddings[1].data);
    const emb3 = Array.from(embeddings[2].data);
    
    const similarity12 = cosineSimilarity(emb1, emb2);
    const similarity13 = cosineSimilarity(emb1, emb3);
    
    console.log(`✅ Embedding dimension: ${emb1.length}`);
    console.log(`✅ "authorized to work" ↔ "legally authorized..." similarity: ${(similarity12 * 100).toFixed(1)}%`);
    console.log(`✅ "authorized to work" ↔ "first name" similarity: ${(similarity13 * 100).toFixed(1)}%`);
    
    // Similar concepts should have higher similarity
    const passed = similarity12 > similarity13;
    console.log(`${passed ? '✅' : '⚠️'} Semantic similarity test ${passed ? 'passed' : 'warning'}`);
    
    return passed;
  } catch (error) {
    console.log(`❌ Embedding test failed: ${error.message}`);
    return false;
  }
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;  // Already normalized
}

function listFiles(dir, indent = '') {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      console.log(`${indent}📁 ${item}/`);
      listFiles(fullPath, indent + '   ');
    } else {
      const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
      console.log(`${indent}📄 ${item} (${sizeMB} MB)`);
    }
  }
}

function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let size = 0;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

async function main() {
  console.log('============================================');
  console.log('🤖 HYBRID CLASSIFIER MODEL DOWNLOADER v2.0');
  console.log('============================================');
  console.log('');
  console.log('This script downloads TWO models for maximum accuracy:');
  console.log('  1. Zero-shot classifier (DeBERTa-v3-large)');
  console.log('  2. Semantic similarity (BGE-M3)');
  console.log('');
  console.log(`📁 Cache directory: ${CACHE_DIR}`);
  console.log(`📊 Total expected size: ~3-4 GB`);
  console.log(`⏱️  Estimated time: 5-15 minutes (depends on connection)`);
  
  // Create cache directory if it doesn't exist
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`\n✅ Created cache directory: ${CACHE_DIR}`);
  }
  
  let zeroShotClassifier = null;
  let embeddingExtractor = null;
  
  // ==========================================
  // DOWNLOAD ZERO-SHOT MODEL
  // ==========================================
  console.log('\n============================================');
  console.log('📥 STEP 1/2: Downloading Zero-Shot Model');
  console.log('============================================');
  
  try {
    zeroShotClassifier = await downloadModel(MODELS.zeroShot, 'zeroShot');
    console.log('✅ Primary zero-shot model downloaded successfully');
  } catch (error) {
    console.log(`\n⚠️  Primary model failed: ${error.message}`);
    console.log('📥 Trying fallback model...');
    
    try {
      zeroShotClassifier = await downloadModel(FALLBACK_MODELS.zeroShot, 'zeroShot');
      console.log('✅ Fallback zero-shot model downloaded successfully');
    } catch (fallbackError) {
      console.error('\n❌ Both primary and fallback zero-shot models failed!');
      console.error(`Error: ${fallbackError.message}`);
      process.exit(1);
    }
  }
  
  // ==========================================
  // DOWNLOAD EMBEDDING MODEL
  // ==========================================
  console.log('\n============================================');
  console.log('📥 STEP 2/2: Downloading Embedding Model');
  console.log('============================================');
  
  try {
    embeddingExtractor = await downloadModel(MODELS.embedding, 'embedding');
    console.log('✅ Primary embedding model downloaded successfully');
  } catch (error) {
    console.log(`\n⚠️  Primary model failed: ${error.message}`);
    console.log('📥 Trying fallback model...');
    
    try {
      embeddingExtractor = await downloadModel(FALLBACK_MODELS.embedding, 'embedding');
      console.log('✅ Fallback embedding model downloaded successfully');
    } catch (fallbackError) {
      console.error('\n❌ Both primary and fallback embedding models failed!');
      console.error(`Error: ${fallbackError.message}`);
      process.exit(1);
    }
  }
  
  // ==========================================
  // TEST MODELS
  // ==========================================
  console.log('\n============================================');
  console.log('🧪 TESTING MODELS');
  console.log('============================================');
  
  const zeroShotPassed = await testZeroShotModel(zeroShotClassifier);
  const embeddingPassed = await testEmbeddingModel(embeddingExtractor);
  
  // ==========================================
  // SUMMARY
  // ==========================================
  console.log('\n============================================');
  console.log('📊 DOWNLOAD SUMMARY');
  console.log('============================================');
  
  // List downloaded files
  console.log('\n📦 Downloaded model files:');
  listFiles(CACHE_DIR);
  
  // Calculate total size
  const totalSize = getDirSize(CACHE_DIR);
  console.log(`\n📊 Total model size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  
  console.log('\n============================================');
  if (zeroShotPassed && embeddingPassed) {
    console.log('✅ ALL MODELS DOWNLOADED AND TESTED SUCCESSFULLY!');
  } else {
    console.log('⚠️  MODELS DOWNLOADED WITH WARNINGS');
    if (!zeroShotPassed) console.log('   - Zero-shot model test had issues');
    if (!embeddingPassed) console.log('   - Embedding model test had issues');
  }
  console.log('============================================');
  
  console.log('\n💡 Next steps:');
  console.log('   1. The models are cached in the "models" folder');
  console.log('   2. Run your form filler: node src/index.js <URL>');
  console.log('   3. First run will load models from cache (~10-15 seconds)');
  console.log('\n🎉 Ready to use hybrid classification!');
}

// Run the download
main().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
