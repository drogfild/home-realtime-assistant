import { z } from 'zod';

export function parseEnv<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const message = result.error.errors
      .map((err) => `${err.path.join('.') || 'env'}: ${err.message}`)
      .join(', ');
    throw new Error(`Invalid environment: ${message}`);
  }
  return result.data;
}
