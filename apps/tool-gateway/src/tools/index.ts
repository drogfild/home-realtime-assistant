import { z } from 'zod';
import { createHomeAssistantTool } from './homeAssistantSensor';
import { createHttpFetchTool } from './httpFetch';
import { createNoteWriterTool } from './noteWriter';
import { Env } from '../config';
import { ToolDefinition } from './types';

export function buildTools(env: Env): ToolDefinition[] {
  const allowlistHosts = env.ALLOWLIST_HTTP_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
  const tools: ToolDefinition[] = [
    createHttpFetchTool(allowlistHosts),
    createHomeAssistantTool(env.HOME_ASSISTANT_URL, env.HOME_ASSISTANT_TOKEN),
    createNoteWriterTool(),
  ];
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
