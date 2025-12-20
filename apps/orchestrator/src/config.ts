import { z } from 'zod';
import { parseEnv } from '@home/shared';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_REALTIME_MODEL: z.string().min(1),
  ORCHESTRATOR_PORT: z.coerce.number().default(3001),
  ORCHESTRATOR_BASE_URL: z.string().url(),
  TOOL_GATEWAY_URL: z.string().url(),
  AUTH_SHARED_SECRET: z.string().min(16),
  INTERNAL_HMAC_SECRET: z.string().min(16),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadConfig(): Env {
  return parseEnv(EnvSchema, process.env);
}
