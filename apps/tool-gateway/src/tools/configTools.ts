import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import { ToolDefinition } from './types';
import { createWebhookTool } from './webhook';

const toolConfigSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
      }),
    )
    .default([]),
});

export function loadConfiguredTools(
  configPath?: string,
  onSkip?: (tool: string, reason: string) => void,
): ToolDefinition[] {
  if (!configPath) return [];
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    onSkip?.('configured_tools', `config file not found: ${resolvedPath}`);
    return [];
  }
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const parsedYaml = YAML.parse(raw) ?? {};
  const parsed = toolConfigSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    onSkip?.('configured_tools', 'invalid config format');
    return [];
  }
  return parsed.data.tools.map((tool) =>
    createWebhookTool({
      name: tool.name,
      description: tool.description,
      url: tool.url,
      headers: tool.headers,
    }),
  );
}
