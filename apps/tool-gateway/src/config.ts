import { z } from 'zod';
import { parseEnv } from '@home/shared';

const EnvSchema = z.object({
  TOOL_GATEWAY_PORT: z.coerce.number().default(4001),
  INTERNAL_HMAC_SECRET: z.string().min(16),
  HOME_ASSISTANT_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  HOME_ASSISTANT_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  ALLOWLIST_HTTP_HOSTS: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadConfig(): Env {
  return parseEnv(EnvSchema, process.env);
}
