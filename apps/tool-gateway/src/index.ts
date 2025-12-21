import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import helmet from 'koa-helmet';
import rateLimit from 'koa-ratelimit';
import dotenv from 'dotenv';
import { createLogger, ensureEnvVars, redactObject, RequestContextSchema } from '@home/shared';
import { loadConfig } from './config';
import { verifyInternalHmac } from './auth';
import { buildTools, resolveTool, validateArgs } from './tools';

dotenv.config();

async function ensureRequiredEnv() {
  await ensureEnvVars([
    { key: 'INTERNAL_HMAC_SECRET', prompt: 'Internal HMAC secret (must match orchestrator)', minLength: 16, allowRandom: true },
  ]);
}

async function bootstrap() {
  await ensureRequiredEnv();
  const env = loadConfig();
  const logger = createLogger('tool-gateway');
  const tools = buildTools(env, {
    onSkipTool(tool, reason) {
      logger.info({ event: 'tool_disabled', tool, reason });
    },
  });

  const app = new Koa();
  const router = new Router();

  const limiter = rateLimit({
    driver: 'memory',
    db: new Map(),
    duration: 60_000,
    errorMessage: 'Too many requests',
    id: (ctx) => ctx.ip,
    max: 120,
  });

  app.use(helmet());
  app.use(limiter);
  app.use(bodyParser());

  router.post('/v1/tools/invoke', verifyInternalHmac(env), async (ctx) => {
    const parseCtx = RequestContextSchema.safeParse({
      requestId: ctx.get('x-request-id') || 'unknown',
      sessionId: ctx.get('x-session-id') || 'unknown',
      userId: ctx.get('x-user-id') || 'unknown',
    });
    const context = parseCtx.success ? parseCtx.data : { requestId: 'unknown', sessionId: 'unknown', userId: 'unknown' };

    const toolName = ctx.request.body?.tool;
    const args = ctx.request.body?.args;
    const tool = toolName ? resolveTool(tools, toolName) : undefined;
    if (!tool) {
      ctx.status = 400;
      ctx.body = { error: 'unknown_tool' };
      return;
    }
    try {
      const validated = validateArgs(tool, args);
      const start = Date.now();
      const result = await tool.handler(validated);
      const duration = Date.now() - start;
      logger.info({
        event: 'tool_success',
        tool: tool.name,
        duration_ms: duration,
        sessionId: context.sessionId,
        requestId: context.requestId,
        userId: context.userId,
      });
      ctx.body = { result };
    } catch (error) {
      logger.warn({
        event: 'tool_error',
        tool: tool.name,
        sessionId: context.sessionId,
        requestId: context.requestId,
        userId: context.userId,
        error: redactObject(error),
      });
      ctx.status = 400;
      ctx.body = { error: (error as Error).message || 'tool_failed' };
    }
  });

  router.get('/v1/tools/list', verifyInternalHmac(env), async (ctx) => {
    ctx.body = {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.parameters ?? {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      })),
    };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  const port = env.TOOL_GATEWAY_PORT;
  app.listen(port, () => {
    logger.info(`tool-gateway listening on ${port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start tool gateway', error);
  process.exit(1);
});
