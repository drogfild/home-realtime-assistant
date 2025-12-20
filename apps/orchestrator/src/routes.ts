import Router from '@koa/router';
import axios from 'axios';
import { Context } from 'koa';
import { createLogger, redactObject, signHmac, ToolInvokeRequestSchema } from '@home/shared';
import { createEphemeralToken } from './openai';
import { Env } from './config';
import { requireAuth, verifyInternalHmac } from './auth';

export function createRoutes(env: Env) {
  const router = new Router();
  const logger = createLogger('orchestrator');

  router.get('/health', (ctx) => {
    ctx.body = { status: 'ok', version: '0.1.0' };
  });

  router.post('/api/realtime/token', requireAuth(env), async (ctx) => {
    const token = await createEphemeralToken(env);
    ctx.body = token;
  });

  router.post('/api/tools/dispatch', requireAuth(env), verifyInternalHmac(env), async (ctx: Context) => {
    const parseResult = ToolInvokeRequestSchema.safeParse(ctx.request.body);
    if (!parseResult.success) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_payload', details: parseResult.error.flatten() };
      return;
    }
    const payload = parseResult.data;
    const body = JSON.stringify(payload);
    const signature = signHmac({ secret: env.INTERNAL_HMAC_SECRET, body });
    const start = Date.now();
    try {
      const response = await axios.post(`${env.TOOL_GATEWAY_URL}/v1/tools/invoke`, payload, {
        headers: {
          'x-internal-signature': signature.signature,
          'x-internal-timestamp': signature.timestamp,
          'content-type': 'application/json',
        },
        timeout: 10_000,
      });
      const duration = Date.now() - start;
      logger.info({
        event: 'tool_dispatch_success',
        tool: payload.tool,
        duration_ms: duration,
        sessionId: ctx.state.sessionId,
        requestId: ctx.state.requestId,
      });
      ctx.body = response.data;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error({
        event: 'tool_dispatch_error',
        tool: payload.tool,
        duration_ms: duration,
        sessionId: ctx.state.sessionId,
        requestId: ctx.state.requestId,
        error: redactObject(error),
      });
      ctx.status = 502;
      ctx.body = { error: 'tool_gateway_unreachable' };
    }
  });

  return router;
}
