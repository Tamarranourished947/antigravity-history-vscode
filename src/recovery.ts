/**
 * Conversation recovery — scan .pb files and trigger LS to index unindexed conversations.
 *
 * Ported from Python CLI recover command.
 *
 * Logic:
 * 1. Scan ~/.gemini/antigravity/conversations/ for .pb files
 * 2. Compare with indexed conversations from LS API
 * 3. For unindexed ones, call GetCascadeTrajectorySteps(id, 5) to trigger on-demand loading
 * 4. After recovery, LS will include them in GetAllCascadeTrajectories
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { callApi } from './ls-client.js';

/**
 * Discover the conversations directory.
 */
export function getConversationsDir(): string | null {
  const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Scan .pb files and return all cascade IDs found on disk.
 */
export function scanPbFiles(convDir: string): string[] {
  try {
    return fs.readdirSync(convDir)
      .filter((f) => f.endsWith('.pb'))
      .map((f) => f.replace('.pb', ''));
  } catch {
    return [];
  }
}

/**
 * Recover unindexed conversations by triggering on-demand loading.
 *
 * @param indexedIds Set of already-indexed cascade IDs
 * @param port Working LS port
 * @param csrf CSRF token
 * @param onProgress Callback for progress updates
 * @returns Number of newly activated conversations
 */
export async function recoverUnindexed(
  indexedIds: Set<string>,
  endpoints: Array<{ port: number; csrf: string }>,
  onProgress?: (done: number, total: number, id: string) => void,
): Promise<{ activated: number; failed: number; total: number }> {
  const convDir = getConversationsDir();
  if (!convDir || endpoints.length === 0) {
    return { activated: 0, failed: 0, total: 0 };
  }

  const allDiskIds = scanPbFiles(convDir);
  const unindexed = allDiskIds.filter((id) => !indexedIds.has(id));

  if (unindexed.length === 0) {
    return { activated: 0, failed: 0, total: 0 };
  }

  let activated = 0;
  let failed = 0;

  // Process in batches of 10, round-robin across endpoints for load balancing
  const batchSize = 10;
  for (let i = 0; i < unindexed.length; i += batchSize) {
    const batch = unindexed.slice(i, i + batchSize);
    const promises = batch.map(async (cascadeId, j) => {
      // Round-robin across available endpoints
      const ep = endpoints[(i + j) % endpoints.length];
      const result = await callApi(
        ep.port, ep.csrf,
        'GetCascadeTrajectorySteps',
        { cascadeId, startIndex: 0, endIndex: 1 },  // stepCount=1, just trigger indexing
        5000,  // 5s timeout (was 10s)
      );
      return { cascadeId, success: result !== null };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.success) { activated++; } else { failed++; }
      onProgress?.(activated + failed, unindexed.length, r.cascadeId);
    }
  }

  return { activated, failed, total: unindexed.length };
}
