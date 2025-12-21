import { ToolDefinition } from './types';
import { createWebhookTool } from './webhook';

export function createN8nWebhookTool(webhookUrl?: string): ToolDefinition | null {
  if (!webhookUrl) return null;
  return createWebhookTool({
    name: 'n8n_webhook',
    description: 'Calls a configured n8n webhook with a JSON payload.',
    url: webhookUrl,
  });
}
