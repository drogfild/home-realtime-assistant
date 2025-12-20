import crypto from 'node:crypto';
import { z } from 'zod';
import { HmacHeaderSchema } from './types';

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export function signHmac({
  secret,
  body,
  timestamp = Date.now(),
}: {
  secret: string;
  body: string;
  timestamp?: number;
}): { signature: string; timestamp: string } {
  const ts = timestamp.toString();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(ts + '.' + body);
  return { signature: hmac.digest('hex'), timestamp: ts };
}

export function verifyHmac({
  secret,
  body,
  header,
  toleranceMs = DEFAULT_TOLERANCE_MS,
}: {
  secret: string;
  body: string;
  header: unknown;
  toleranceMs?: number;
}): boolean {
  const parsed = HmacHeaderSchema.safeParse(header);
  if (!parsed.success) return false;
  const { signature, timestamp } = parsed.data;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const age = Math.abs(Date.now() - tsNum);
  if (age > toleranceMs) return false;
  const expected = signHmac({ secret, body, timestamp: tsNum }).signature;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const RedactionRuleSchema = z.object({
  pattern: z.instanceof(RegExp),
  replacement: z.string().default('[REDACTED]'),
});

export type RedactionRule = z.infer<typeof RedactionRuleSchema>;
