import axios from 'axios';
import { z } from 'zod';
import { ToolDefinition } from './types';

export const homeAssistantSchema = z.object({
  entity_id: z.string().min(1),
});

export function createHomeAssistantTool(baseUrl?: string, token?: string): ToolDefinition {
  return {
    name: 'home_assistant_sensor',
    description: 'Reads a sensor value from Home Assistant (read-only)',
    parameters: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Home Assistant entity id' },
      },
      required: ['entity_id'],
      additionalProperties: false,
    },
    schema: homeAssistantSchema,
    async handler(rawArgs) {
      if (!baseUrl || !token) {
        throw new Error('home_assistant_not_configured');
      }
      const parsed = homeAssistantSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new Error('invalid_args');
      }
      const url = `${baseUrl}/api/states/${encodeURIComponent(parsed.data.entity_id)}`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 3_000,
      });
      return { entity_id: parsed.data.entity_id, state: response.data.state, last_changed: response.data.last_changed };
    },
  };
}
