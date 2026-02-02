// Utility functions for JobFill Auto-Debugger

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
}

export function extractPlatformFromUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  
  if (hostname.includes('workday') || hostname.includes('myworkdayjobs')) return 'workday';
  if (hostname.includes('successfactors')) return 'successfactors';
  if (hostname.includes('greenhouse')) return 'greenhouse';
  if (hostname.includes('lever.co')) return 'lever';
  if (hostname.includes('icims')) return 'icims';
  if (hostname.includes('taleo')) return 'taleo';
  if (hostname.includes('jobvite')) return 'jobvite';
  if (hostname.includes('smartrecruiters')) return 'smartrecruiters';
  if (hostname.includes('ultipro') || hostname.includes('ukg')) return 'ultipro';
  if (hostname.includes('ashbyhq')) return 'ashby';
  if (hostname.includes('breezy')) return 'breezy';
  if (hostname.includes('jazz')) return 'jazz';
  if (hostname.includes('bamboo')) return 'bamboo';
  if (hostname.includes('paycom')) return 'paycom';
  if (hostname.includes('paylocity')) return 'paylocity';
  
  return 'custom';
}

export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
