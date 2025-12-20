import axios from 'axios';
import httpAdapter from 'axios/lib/adapters/http.js';
import { z } from 'zod';
import { ToolDefinition } from './types';

export const httpFetchSchema = z.object({
  host: z.string().min(1),
  path: z.string().default('/'),
});

const httpClient = axios.create({ adapter: httpAdapter });

type HttpClient = {
  get: (url: string, config: { timeout: number }) => Promise<{ status: number; data: unknown }>;
};

export function createHttpFetchTool(allowlist: string[], client: HttpClient = httpClient): ToolDefinition {
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
      const response = await client.get(url, { timeout: 3_000 });
      return { status: response.status, data: response.data };
    },
  };
}
