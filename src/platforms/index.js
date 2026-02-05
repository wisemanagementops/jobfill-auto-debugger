// ============================================
// PLATFORM DETECTOR
// Detects which ATS platform we're on and returns the appropriate handler
// ============================================

import WorkdayPlatform from './workday.js';
// import iCIMSPlatform from './icims.js';  // Coming soon
// import GreenhousePlatform from './greenhouse.js';  // Coming soon

const platforms = [
  WorkdayPlatform,
  // iCIMSPlatform,
  // GreenhousePlatform,
];

export function detectPlatform(url) {
  for (const platform of platforms) {
    for (const pattern of platform.urlPatterns) {
      if (pattern.test(url)) {
        return platform;
      }
    }
  }
  return null;
}

export function getPlatformByName(name) {
  for (const platform of platforms) {
    if (platform.name === name) {
      return platform;
    }
  }
  return null;
}

export { WorkdayPlatform };
// export { iCIMSPlatform };
// export { GreenhousePlatform };

export default { detectPlatform, getPlatformByName };
