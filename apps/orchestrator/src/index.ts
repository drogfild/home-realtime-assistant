import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import helmet from 'koa-helmet';
import cors from 'koa-cors';
import rateLimit from 'koa-ratelimit';
import dotenv from 'dotenv';
import { createRoutes } from './routes';
import { attachRequestIds } from './auth';
import { loadConfig } from './config';
import { createLogger } from '@home/shared';

dotenv.config();

async function bootstrap() {
  const env = loadConfig();
  const logger = createLogger('orchestrator');
  const app = new Koa();

  const rateLimiter = rateLimit({
    driver: 'memory',
    db: new Map(),
    duration: 60_000,
    errorMessage: 'Too many requests',
    id: (ctx) => ctx.ip,
    max: 60,
  });

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(rateLimiter);
  app.use(bodyParser());
  app.use(attachRequestIds());

  const router = createRoutes(env);
  app.use(router.routes());
  app.use(router.allowedMethods());

  const port = env.ORCHESTRATOR_PORT;
  app.listen(port, () => {
    logger.info(`orchestrator listening on ${port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start orchestrator', error);
  process.exit(1);
});
