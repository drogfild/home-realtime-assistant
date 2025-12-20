import { Context, Next } from 'koa';
import { verifyHmac } from '@home/shared';
import crypto from 'node:crypto';
import { Env } from './config';

const AUTH_HEADER = 'x-shared-secret';
const HMAC_SIGNATURE = 'x-internal-signature';
const HMAC_TIMESTAMP = 'x-internal-timestamp';

export function requireAuth(env: Env) {
  return async (ctx: Context, next: Next) => {
    const secret = ctx.get(AUTH_HEADER);
    if (!secret || secret !== env.AUTH_SHARED_SECRET) {
      ctx.status = 401;
      ctx.body = { error: 'unauthorized' };
      return;
    }
    await next();
  };
}

export function verifyInternalHmac(env: Env) {
  return async (ctx: Context, next: Next) => {
    const signature = ctx.get(HMAC_SIGNATURE);
    const timestamp = ctx.get(HMAC_TIMESTAMP);
    const body = JSON.stringify(ctx.request.body ?? {});
    const valid = verifyHmac({
      secret: env.INTERNAL_HMAC_SECRET,
      body,
      header: { signature, timestamp },
    });
    if (!valid) {
      ctx.status = 401;
      ctx.body = { error: 'invalid_signature' };
      return;
    }
    await next();
  };
}

export function attachRequestIds() {
  return async (ctx: Context, next: Next) => {
    ctx.state.requestId = ctx.get('x-request-id') || crypto.randomUUID();
    ctx.state.sessionId = ctx.get('x-session-id') || crypto.randomUUID();
    await next();
  };
}
