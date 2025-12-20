import axios from 'axios';
import { z } from 'zod';
import { ToolDefinition } from './types';

export const httpFetchSchema = z.object({
  host: z.string().min(1),
  path: z.string().default('/'),
});

export function createHttpFetchTool(allowlist: string[]): ToolDefinition {
  return {
    name: 'http_fetch',
    description: 'Performs a GET request to an allowlisted host',
    schema: httpFetchSchema,
    async handler(rawArgs) {
      const parse = httpFetchSchema.safeParse(rawArgs);
      if (!parse.success) {
        throw new Error('invalid_args');
      }
      const { host, path } = parse.data;
      if (!allowlist.includes(host)) {
        throw new Error('host_not_allowed');
      }
      const url = `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
      const response = await axios.get(url, { timeout: 3_000 });
      return { status: response.status, data: response.data };
    },
  };
}
