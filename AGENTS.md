# AGENTS.md

## Repo overview
- Monorepo for a PWA realtime voice assistant using OpenAI Realtime API over WebRTC.
- Key apps: web UI, orchestrator backend, tool-gateway with allowlisted tools.

## Key paths
- apps/web: iOS Safari / PWA UI.
- apps/orchestrator: issues ephem tokens, sets session policy, routes tool calls.
- apps/tool-gateway: allowlisted tools with Zod schemas + HMAC auth.
- packages/shared: shared schemas, helpers, logger.
- infra: docker compose and reverse proxy examples.

## Local dev
- Install: pnpm install
- Run services:
  - pnpm --filter @home/tool-gateway dev   # 4001
  - pnpm --filter @home/orchestrator dev   # 3001
  - pnpm --filter @home/web dev            # 4173
- Docker: docker compose -f infra/docker-compose.yml up --build

## Env and secrets
- Each app has a .env.example; copy to .env and fill values.
- Required secrets: OPENAI_API_KEY, AUTH_SHARED_SECRET, INTERNAL_HMAC_SECRET.
- Tool HTTP access is restricted by ALLOWLIST_HTTP_HOSTS.
- Keep secrets out of logs and responses.

## Security model (short)
- Browser calls POST /api/realtime/token with x-shared-secret.
- Orchestrator signs internal tool calls with HMAC.
- Tool-gateway rejects unknown tools and non-allowlisted hosts.

## Adding a new tool
- Create apps/tool-gateway/src/tools/<tool>.ts exporting { name, schema, handler }.
- Register in apps/tool-gateway/src/tools/index.ts (buildTools).
- Update allowlist env vars if needed.
- Add tests in apps/tool-gateway/src/tools/*.test.ts.

## Tests
- pnpm test (Vitest for HMAC, schemas, allowlist behavior).

## GitHub
- origin: https://github.com/drogfild/home-realtime-assistant (fetch/push).

## Notes
- tool-gateway is internal-only and audited.
- http_fetch is allowlist-only; home_assistant_sensor is read-only.
