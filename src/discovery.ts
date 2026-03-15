/**
 * Process discovery module — auto-detect running Antigravity LanguageServer instances.
 *
 * Ported from Python: antigravity_history/discovery.py (177 lines)
 *
 * Known issues addressed:
 * - CSRF Token changes on every restart → extracted from process cmdline args
 * - Port is dynamically assigned → scanned via netstat (Win) / lsof (Mac)
 * - Multiple workspaces = multiple LS instances → scan all, test each
 */

import { execSync } from 'child_process';
import * as os from 'os';

export interface LsProcess {
  pid: number;
  csrf: string;
  cmd: string;
}

export interface LsEndpoint {
  port: number;
  csrf: string;
  pid: number;
}

/**
 * Discover all running language_server processes.
 */
export function discoverLanguageServers(): LsProcess[] {
  const system = os.platform();
  if (system === 'win32') {
    return discoverWindows();
  } else if (system === 'darwin') {
    return discoverMacOS();
  } else if (system === 'linux') {
    return discoverLinux();
  }
  return [];
}

/**
 * Windows: query language_server processes via WMI (PowerShell).
 */
function discoverWindows(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const cmd =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | " +
      'Select-Object ProcessId, CommandLine | ConvertTo-Json';
    const stdout = execSync(`powershell -Command "${cmd}"`, {
      timeout: 15000,
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (!stdout.trim()) {return servers;}

    let data = JSON.parse(stdout);
    if (!Array.isArray(data)) {data = [data];}

    for (const proc of data) {
      const cmdLine: string = proc.CommandLine || '';
      const pid: number = proc.ProcessId;
      if (!cmdLine) {continue;}
      const csrf = extractCsrf(cmdLine);
      servers.push({ pid, csrf, cmd: cmdLine });
    }
  } catch {
    // WMI query failed — silently ignore
  }
  return servers;
}

/**
 * macOS: query via pgrep + ps.
 */
function discoverMacOS(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const pids = execSync('pgrep -f language_server_macos', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {continue;}
      try {
        const cmdLine = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        const csrf = extractCsrf(cmdLine);
        servers.push({ pid, csrf, cmd: cmdLine });
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // pgrep found nothing
  }
  return servers;
}

/**
 * Linux: query via pgrep + ps (similar to macOS).
 */
function discoverLinux(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const pids = execSync('pgrep -f language_server', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {continue;}
      try {
        const cmdLine = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        const csrf = extractCsrf(cmdLine);
        servers.push({ pid, csrf, cmd: cmdLine });
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // pgrep found nothing
  }
  return servers;
}

/** Extract --csrf_token value from a command line string. */
function extractCsrf(cmdLine: string): string {
  const m = cmdLine.match(/--csrf_token\s+(\S+)/);
  return m ? m[1] : '';
}

/**
 * Find ports a given process is listening on.
 */
export function findPorts(pid: number): number[] {
  if (os.platform() === 'win32') {
    return findPortsWindows(pid);
  } else {
    return findPortsUnix(pid);
  }
}

function findPortsWindows(pid: number): number[] {
  const ports: number[] = [];
  try {
    const stdout = execSync('netstat -ano', {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    const pidStr = String(pid);
    for (const line of stdout.split('\n')) {
      if (line.includes('LISTENING') && line.includes(pidStr)) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m) {ports.push(parseInt(m[1], 10));}
      }
    }
  } catch {
    // netstat failed
  }
  return ports;
}

function findPortsUnix(pid: number): number[] {
  const ports: number[] = [];
  try {
    const stdout = execSync(`lsof -p ${pid} -i -P -n`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    for (const line of stdout.split('\n')) {
      if (line.includes('LISTEN')) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (m) {ports.push(parseInt(m[1], 10));}
      }
    }
  } catch {
    // lsof failed
  }
  return ports;
}
