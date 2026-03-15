/**
 * LanguageServer API client.
 *
 * Ported from Python: antigravity_history/api.py (129 lines)
 *
 * Known issues addressed:
 * - Self-signed certificate → rejectUnauthorized: false
 * - API only available at runtime → all calls have timeout + error handling
 */

import * as https from 'https';
import { LsEndpoint, LsProcess, discoverLanguageServers, findPorts } from './discovery.js';

const BASE_PATH = 'exa.language_server_pb.LanguageServerService';

/** Raw API response types */
export interface TrajectorySummary {
  summary?: string;
  stepCount?: number;
  createdTime?: string;
  lastModifiedTime?: string;
  lastUserInputTime?: string;
  status?: string;
  workspaces?: Array<{ workspaceFolderAbsoluteUri?: string }>;
}

export interface TrajectoryStep {
  type?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  userInput?: Record<string, unknown>;
  plannerResponse?: Record<string, unknown>;
  codeAction?: Record<string, unknown>;
  runCommand?: Record<string, unknown>;
  viewFile?: Record<string, unknown>;
  grepSearch?: Record<string, unknown>;
  find?: Record<string, unknown>;
  listDirectory?: Record<string, unknown>;
  searchWeb?: Record<string, unknown>;
  readUrlContent?: Record<string, unknown>;
  sendCommandInput?: Record<string, unknown>;
  commandStatus?: Record<string, unknown>;
  errorMessage?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Call LanguageServer gRPC-Web API.
 */
export function callApi(
  port: number,
  csrfToken: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout = 15000,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify(params);
    const options: https.RequestOptions = {
      hostname: 'localhost',
      port,
      path: `/${BASE_PATH}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
      timeout,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {data += chunk.toString();});
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Get all conversation summaries from a single LS instance.
 */
export async function getAllTrajectories(
  port: number,
  csrf: string,
): Promise<Record<string, TrajectorySummary>> {
  const result = await callApi(port, csrf, 'GetAllCascadeTrajectories', {}, 3000);
  if (!result) {return {};}
  return (result.trajectorySummaries as Record<string, TrajectorySummary>) || {};
}

/**
 * Discover endpoints and merge conversation summaries from all LS instances.
 */
export async function discoverAndListAll(): Promise<{
  conversations: Record<string, TrajectorySummary>;
  cascadeToEndpoint: Record<string, { port: number; csrf: string }>;
  endpoints: LsEndpoint[];
}> {
  const servers = discoverLanguageServers();
  const conversations: Record<string, TrajectorySummary> = {};
  const cascadeToEndpoint: Record<string, { port: number; csrf: string }> = {};
  const endpoints: LsEndpoint[] = [];
  const seenPorts = new Set<number>();

  // Build all probe tasks (first port per process)
  const probeTasks: Array<{ srv: LsProcess; port: number }> = [];
  for (const srv of servers) {
    const ports = findPorts(srv.pid);
    for (const port of ports) {
      if (!seenPorts.has(port)) {
        probeTasks.push({ srv, port });
        seenPorts.add(port);
        break; // One port per process to probe
      }
    }
  }

  // Query all LS instances in parallel (like Python ThreadPoolExecutor)
  const results = await Promise.all(
    probeTasks.map(async ({ srv, port }) => {
      const summaries = await getAllTrajectories(port, srv.csrf);
      return { srv, port, summaries };
    }),
  );

  for (const { srv, port, summaries } of results) {
    if (Object.keys(summaries).length > 0) {
      endpoints.push({ port, csrf: srv.csrf, pid: srv.pid });
      for (const [cid, info] of Object.entries(summaries)) {
        if (!(cid in conversations)) {
          conversations[cid] = info;
          cascadeToEndpoint[cid] = { port, csrf: srv.csrf };
        }
      }
    }
  }

  return { conversations, cascadeToEndpoint, endpoints };
}

/**
 * Get all steps for a conversation.
 */
export async function getTrajectorySteps(
  port: number,
  csrf: string,
  cascadeId: string,
  stepCount = 1000,
): Promise<TrajectoryStep[]> {
  const result = await callApi(
    port,
    csrf,
    'GetCascadeTrajectorySteps',
    { cascadeId, startIndex: 0, endIndex: stepCount + 10 },
    30000,
  );
  if (!result) {return [];}
  return (result.steps as TrajectoryStep[]) || (result.messages as TrajectoryStep[]) || [];
}
