// Session Manager - Handles authentication and session persistence
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import config from './config.js';

export class SessionManager {
  constructor(runner) {
    this.runner = runner;
    this.sessionsDir = join(config.patchesDir, '../sessions');
    this.sessions = new Map();
  }

  async initialize() {
    await mkdir(this.sessionsDir, { recursive: true });
    await this.loadSavedSessions();
  }

  // Get session key from URL (e.g., "workday_company" or "successfactors_ametek")
  getSessionKey(url) {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Extract platform and company
    if (hostname.includes('myworkdayjobs')) {
      const company = hostname.split('.')[0];
      return `workday_${company}`;
    }
    if (hostname.includes('successfactors')) {
      const match = url.match(/company=(\w+)/);
      return `successfactors_${match ? match[1] : 'unknown'}`;
    }
    if (hostname.includes('greenhouse')) {
      const match = url.match(/greenhouse\.io\/(\w+)/);
      return `greenhouse_${match ? match[1] : 'unknown'}`;
    }
    if (hostname.includes('lever.co')) {
      const match = hostname.match(/jobs\.lever\.co/);
      return `lever_${hostname.split('.')[0]}`;
    }
    
    // Generic fallback
    return hostname.replace(/\./g, '_');
  }

  async loadSavedSessions() {
    try {
      const sessionsFile = join(this.sessionsDir, 'sessions.json');
      if (existsSync(sessionsFile)) {
        const data = JSON.parse(await readFile(sessionsFile, 'utf-8'));
        for (const [key, session] of Object.entries(data)) {
          // Check if session is still valid (not expired)
          if (session.expiresAt && new Date(session.expiresAt) > new Date()) {
            this.sessions.set(key, session);
          }
        }
        console.log(`📂 Loaded ${this.sessions.size} saved sessions`);
      }
    } catch (error) {
      console.log('No saved sessions found');
    }
  }

  async saveSessions() {
    const sessionsFile = join(this.sessionsDir, 'sessions.json');
    const data = Object.fromEntries(this.sessions);
    await writeFile(sessionsFile, JSON.stringify(data, null, 2));
  }

  async saveCurrentSession(url) {
    const key = this.getSessionKey(url);
    const page = this.runner.page;
    
    // Get cookies
    const cookies = await page.cookies();
    
    // Get localStorage and sessionStorage
    const storage = await page.evaluate(() => {
      return {
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage }
      };
    });
    
    const session = {
      key,
      url,
      cookies,
      storage,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    };
    
    this.sessions.set(key, session);
    await this.saveSessions();
    
    // Also save cookies to file for this specific session
    const cookieFile = join(this.sessionsDir, `${key}_cookies.json`);
    await writeFile(cookieFile, JSON.stringify(cookies, null, 2));
    
    console.log(`💾 Session saved for ${key} (${cookies.length} cookies)`);
    return session;
  }

  async loadSession(url) {
    const key = this.getSessionKey(url);
    const session = this.sessions.get(key);
    
    if (!session) {
      console.log(`❌ No saved session for ${key}`);
      return false;
    }
    
    const page = this.runner.page;
    
    // Load cookies
    if (session.cookies && session.cookies.length > 0) {
      await page.setCookie(...session.cookies);
      console.log(`🍪 Loaded ${session.cookies.length} cookies for ${key}`);
    }
    
    // Note: localStorage/sessionStorage must be set after navigation
    return true;
  }

  async restoreStorage(url) {
    const key = this.getSessionKey(url);
    const session = this.sessions.get(key);
    
    if (!session?.storage) return;
    
    const page = this.runner.page;
    
    await page.evaluate((storage) => {
      if (storage.localStorage) {
        for (const [k, v] of Object.entries(storage.localStorage)) {
          localStorage.setItem(k, v);
        }
      }
      if (storage.sessionStorage) {
        for (const [k, v] of Object.entries(storage.sessionStorage)) {
          sessionStorage.setItem(k, v);
        }
      }
    }, session.storage);
    
    console.log(`📦 Restored storage for ${key}`);
  }

  hasSession(url) {
    const key = this.getSessionKey(url);
    return this.sessions.has(key);
  }

  async clearSession(url) {
    const key = this.getSessionKey(url);
    this.sessions.delete(key);
    await this.saveSessions();
    console.log(`🗑️ Session cleared for ${key}`);
  }

  async clearAllSessions() {
    this.sessions.clear();
    await this.saveSessions();
    console.log(`🗑️ All sessions cleared`);
  }
}

export default SessionManager;
