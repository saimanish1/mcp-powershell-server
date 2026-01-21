import * as os from 'node:os';
import * as process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function hasCommandOnWindows(cmd) {
  const r = spawnSync('where', [cmd], { stdio: 'ignore', shell: false, windowsHide: true });
  return r.status === 0;
}

function getShellConfiguration() {
  if (os.platform() !== 'win32') {
    throw new Error('This server is PowerShell-only. Run it on Windows.');
  }

  const override = process.env['MCP_SHELL_EXE']?.trim();
  const executable = override || (hasCommandOnWindows('pwsh') ? 'pwsh.exe' : 'powershell.exe');

  return {
    executable,
    argsPrefix: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'],
  };
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

async function taskkillTree(pid) {
  await new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    killer.on('close', () => resolve());
    killer.on('error', () => resolve());
  });
}

function spawnWithOutputLimit({ shell, command, cwd, maxBytes }) {
  const child = spawn(
    shell.executable,
    [...shell.argsPrefix, encodePowerShellCommand(command)],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      },
    }
  );

  let truncated = false;

  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  const append = (which, chunk) => {
    if (truncated) return;

    const used = which === 'stdout' ? stdoutBytes : stderrBytes;
    const room = maxBytes - used;
    if (room <= 0) {
      truncated = true;
      return;
    }

    const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (which === 'stdout') {
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
    } else {
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    }

    if (slice.length !== chunk.length) truncated = true;
  };

  const onStdout = (d) => append('stdout', d);
  const onStderr = (d) => append('stderr', d);

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);

  const cleanup = () => {
    child.stdout?.off('data', onStdout);
    child.stderr?.off('data', onStderr);
  };

  const getStdout = () => Buffer.concat(stdoutChunks).toString('utf8');
  const getStderr = () => Buffer.concat(stderrChunks).toString('utf8');

  return { child, cleanup, getStdout, getStderr, isTruncated: () => truncated };
}

async function waitForExit(child, cleanup, timeoutMs) {
  let timedOut = false;

  const exit = await new Promise((resolve) => {
    let settled = false;

    const resolveOnce = (v) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    };

    const t = setTimeout(async () => {
      timedOut = true;
      if (child.pid) await taskkillTree(child.pid);
      resolveOnce({ code: null, signal: 'SIGTERM' });
    }, timeoutMs);

    child.once('close', (code, signal) => {
      clearTimeout(t);
      resolveOnce({ code: code ?? null, signal: signal ?? null });
    });

    child.once('error', () => {
      clearTimeout(t);
      resolveOnce({ code: null, signal: null });
    });
  });

  return { exit, timedOut };
}

const server = new McpServer({ name: 'mcp-shell-server', version: '2.0.0' });

server.registerTool(
  'run_shell_command',
  {
    description:
      'Execute commands using PowerShell on Windows (PowerShell-only). Returns stdout, stderr, exit code, signal, and flags for timeout/truncation.',
    inputSchema: z
      .object({
        command: z.string().min(1).describe('PowerShell command/script to execute'),
        cwd: z.string().optional().describe('Working directory'),
        timeoutMs: z.number().int().positive().optional().describe('Timeout in ms (max 10 minutes)'),
        maxOutputBytes: z.number().int().positive().optional().describe('Max output bytes per stream (max 2MB)'),
      })
      .shape,
  },
  async ({ command, cwd, timeoutMs, maxOutputBytes }) => {
    const shell = getShellConfiguration();

    const timeout = Math.min(timeoutMs ?? 60_000, 10 * 60_000);
    const maxBytes = Math.min(maxOutputBytes ?? 64_000, 2_000_000);

    const { child, cleanup, getStdout, getStderr, isTruncated } = spawnWithOutputLimit({
      shell,
      command,
      cwd,
      maxBytes,
    });

    const { exit, timedOut } = await waitForExit(child, cleanup, timeout);

    if (isTruncated() && child.pid) {
      await taskkillTree(child.pid);
    }

    const response = {
      stdout: getStdout(),
      stderr: getStderr(),
      exitCode: exit.code,
      signal: exit.signal,
      truncated: isTruncated(),
      timedOut,
      platform: os.platform(),
      shell: shell.executable,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: timedOut || response.truncated || (response.exitCode !== 0 && response.exitCode !== null),
    };
  }
);

await server.connect(new StdioServerTransport());
