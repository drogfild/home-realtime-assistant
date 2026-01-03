import { z } from 'zod';
import { spawn } from 'node:child_process';
import { ToolDefinition } from './types';

const DEFAULT_HOST = '192.168.1.1';

const routerPingSchema = z.object({}).strict();

type PingResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type PingRunner = (host: string) => Promise<PingResult>;

function defaultPingRunner(host: string): Promise<PingResult> {
  const args =
    process.platform === 'darwin'
      ? ['-c', '1', '-W', '1000', host]
      : ['-c', '1', '-W', '1', host];

  return new Promise((resolve) => {
    const child = spawn('ping', args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout: '', stderr: error.message });
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseLatencyMs(output: string): number | null {
  const match = output.match(/time[=<]([0-9.]+)\s*ms/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function createRouterPingTool(runner: PingRunner = defaultPingRunner): ToolDefinition {
  return {
    name: 'router_reachable',
    description: 'Checks if the local router responds to a single ping.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    schema: routerPingSchema,
    async handler(rawArgs) {
      const parsed = routerPingSchema.safeParse(rawArgs);
      if (!parsed.success) throw new Error('invalid_args');
      const result = await runner(DEFAULT_HOST);
      const reachable = result.code === 0;
      return {
        host: DEFAULT_HOST,
        reachable,
        latency_ms: reachable ? parseLatencyMs(result.stdout) : null,
      };
    },
  };
}
