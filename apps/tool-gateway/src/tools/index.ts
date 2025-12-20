import { z } from 'zod';
import { createHomeAssistantTool } from './homeAssistantSensor';
import { createHttpFetchTool } from './httpFetch';
import { createNoteWriterTool } from './noteWriter';
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
  ];
  if (env.HOME_ASSISTANT_URL && env.HOME_ASSISTANT_TOKEN) {
    tools.push(createHomeAssistantTool(env.HOME_ASSISTANT_URL, env.HOME_ASSISTANT_TOKEN));
  } else {
    options?.onSkipTool?.('home_assistant_sensor', 'HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN are required');
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
