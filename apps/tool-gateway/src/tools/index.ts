import { z } from 'zod';
import { createHomeAssistantTool } from './homeAssistantSensor';
import { createHttpFetchTool } from './httpFetch';
import { loadConfiguredTools } from './configTools';
import { createN8nWebhookTool } from './n8nWebhook';
import { createNoteWriterTool } from './noteWriter';
import { createRouterPingTool } from './routerPing';
import { Env } from '../config';
import { ToolDefinition } from './types';

type BuildToolsOptions = {
  onSkipTool?: (tool: string, reason: string) => void;
};

export function buildTools(env: Env, options?: BuildToolsOptions): ToolDefinition[] {
  const allowlistHosts = env.ALLOWLIST_HTTP_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
  const tools: ToolDefinition[] = [
    createHttpFetchTool(allowlistHosts),
    createNoteWriterTool(),
    createRouterPingTool(),
  ];
  const n8nTool = createN8nWebhookTool(env.N8N_WEBHOOK_URL);
  if (n8nTool) {
    tools.push(n8nTool);
  } else {
    options?.onSkipTool?.('n8n_webhook', 'N8N_WEBHOOK_URL is required');
  }
  if (env.HOME_ASSISTANT_URL && env.HOME_ASSISTANT_TOKEN) {
    tools.push(createHomeAssistantTool(env.HOME_ASSISTANT_URL, env.HOME_ASSISTANT_TOKEN));
  } else {
    options?.onSkipTool?.('home_assistant_sensor', 'HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN are required');
  }
  const configured = loadConfiguredTools(env.TOOL_CONFIG_PATH, options?.onSkipTool);
  if (configured.length > 0) {
    const names = new Set(tools.map((tool) => tool.name));
    for (const tool of configured) {
      if (names.has(tool.name)) {
        options?.onSkipTool?.(tool.name, 'configured tool name already in use');
        continue;
      }
      tools.push(tool);
      names.add(tool.name);
    }
  }
  return tools;
}

export function resolveTool(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

export function validateArgs(tool: ToolDefinition, args: unknown) {
  const result = (tool.schema as z.ZodTypeAny).safeParse(args);
  if (!result.success) {
    throw new Error('invalid_args');
  }
  return result.data;
}
