import { Context, Next } from 'koa';
import { verifyHmac } from '@home/shared';
import { Env } from './config';

const HMAC_SIGNATURE = 'x-internal-signature';
const HMAC_TIMESTAMP = 'x-internal-timestamp';

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
