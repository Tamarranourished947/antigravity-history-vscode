/**
 * Local JSON cache for conversation summaries.
 *
 * Provides instant UI on IDE restart by caching the last known conversation list.
 * Cache is updated after every successful API refresh.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrajectorySummary } from './ls-client.js';

const CACHE_DIR = path.join(os.homedir(), '.gemini', 'antigravity-history');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');

interface CacheData {
  version: 1;
  updatedAt: string;
  conversations: Record<string, TrajectorySummary>;
}

/**
 * Read cached conversation summaries. Returns empty object on any error.
 */
export function readCache(): Record<string, TrajectorySummary> {
  try {
    if (!fs.existsSync(CACHE_FILE)) { return {}; }
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data: CacheData = JSON.parse(raw);
    if (data.version !== 1) { return {}; }
    return data.conversations || {};
  } catch {
    return {};
  }
}

/**
 * Write conversation summaries to cache.
 */
export function writeCache(conversations: Record<string, TrajectorySummary>): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data: CacheData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      conversations,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch {
    // Silently ignore write failures
  }
}
