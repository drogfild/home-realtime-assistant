import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import helmet from 'koa-helmet';
import cors from 'koa-cors';
import rateLimit from 'koa-ratelimit';
import dotenv from 'dotenv';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRoutes } from './routes';
import { attachRequestIds } from './auth';
import { loadConfig } from './config';
import { createLogger, ensureEnvVars } from '@home/shared';

dotenv.config();

async function ensureRequiredEnv() {
  await ensureEnvVars([
    { key: 'OPENAI_API_KEY', prompt: 'Enter your OpenAI API key', minLength: 1 },
    { key: 'OPENAI_REALTIME_MODEL', prompt: 'OpenAI Realtime model', defaultValue: 'gpt-4o-realtime-preview' },
    { key: 'AUTH_SHARED_SECRET', prompt: 'Shared secret for web clients (x-shared-secret)', minLength: 16, allowRandom: true },
    { key: 'INTERNAL_HMAC_SECRET', prompt: 'Internal HMAC secret (must match tool-gateway)', minLength: 16, allowRandom: true },
    { key: 'ORCHESTRATOR_BASE_URL', prompt: 'Orchestrator base URL (e.g. http://localhost:3001)', minLength: 1 },
    { key: 'TOOL_GATEWAY_URL', prompt: 'Tool gateway URL (e.g. http://localhost:4001)', minLength: 1 },
  ]);
}

async function bootstrap() {
  await ensureRequiredEnv();
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
  const server = createServer(app);
  server.listen(port, () => {
    const localIp = getLocalIp();
    const localUrl = localIp ? `${env.ORCHESTRATOR_BASE_URL.startsWith('https') ? 'https' : 'http'}://${localIp}:${port}` : null;
    logger.info(`orchestrator listening on ${env.ORCHESTRATOR_BASE_URL}${localUrl ? ` (local: ${localUrl})` : ''}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start orchestrator', error);
  process.exit(1);
});

function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

function createServer(app: Koa) {
  const keyPath = process.env.ORCHESTRATOR_TLS_KEY;
  const certPath = process.env.ORCHESTRATOR_TLS_CERT;
  if (keyPath && certPath) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    return https.createServer({ key, cert }, app.callback());
  }
  return http.createServer(app.callback());
}
