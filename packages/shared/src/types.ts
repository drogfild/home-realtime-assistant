import { z } from 'zod';

export const SharedAuthConfigSchema = z.object({
  AUTH_SHARED_SECRET: z.string().min(16),
  INTERNAL_HMAC_SECRET: z.string().min(16),
});

export const RequestContextSchema = z.object({
  requestId: z.string().min(8),
  sessionId: z.string().min(8),
  userId: z.string().min(1),
});

export const ToolInvokeRequestSchema = z.object({
  tool: z.string().min(1),
  args: z.unknown(),
});

export const HmacHeaderSchema = z.object({
  signature: z.string().min(32),
  timestamp: z.string().regex(/^\d+$/),
});

export type RequestContext = z.infer<typeof RequestContextSchema>;
export type ToolInvokeRequest = z.infer<typeof ToolInvokeRequestSchema>;
