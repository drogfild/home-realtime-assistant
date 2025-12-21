import axios from 'axios';
import httpAdapter from 'axios/lib/adapters/http.js';
import { z } from 'zod';
import { ToolDefinition } from './types';

const httpClient = axios.create({ adapter: httpAdapter });

const webhookSchema = z.object({
  payload: z.record(z.unknown()).default({}),
});

export const webhookParameters = {
  type: 'object',
  properties: {
    payload: {
      type: 'object',
      description: 'JSON payload to send to the webhook',
      additionalProperties: true,
    },
  },
  required: [],
  additionalProperties: false,
};

type WebhookConfig = {
  name: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export function createWebhookTool(config: WebhookConfig): ToolDefinition {
  return {
    name: config.name,
    description: config.description ?? 'Calls a configured webhook with a JSON payload.',
    parameters: webhookParameters,
    schema: webhookSchema,
    async handler(rawArgs) {
      const parsed = webhookSchema.safeParse(rawArgs);
      if (!parsed.success) throw new Error('invalid_args');
      const response = await httpClient.post(config.url, parsed.data.payload, {
        headers: config.headers,
        timeout: config.timeoutMs ?? 5_000,
      });
      return { status: response.status, data: response.data };
    },
  };
}
