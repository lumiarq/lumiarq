---
title: Deployment
description: Deploying Lumiarq applications to Node.js, Cloudflare Workers, and static hosts
section: Getting Started
order: 5
draft: false
---

# Deployment

- [Introduction](#introduction)
- [Build targets](#build-targets)
- [Pre-deploy checks](#pre-deploy-checks)
- [Environment variables](#environment-variables)
- [Deploying to Node.js (Docker)](#deploying-to-nodejs-docker)
- [Running with PM2](#running-with-pm2)
- [Nginx reverse proxy](#nginx-reverse-proxy)
- [Database migrations on deploy](#database-migrations-on-deploy)
- [Health check endpoint](#health-check-endpoint)
- [Deploying to Cloudflare Workers](#deploying-to-cloudflare-workers)
- [GitHub Actions CI/CD pipeline](#github-actions-cicd-pipeline)
- [Zero-downtime deploy with PM2](#zero-downtime-deploy-with-pm2)

<a name="introduction"></a>
## Introduction

LumiARQ supports three deployment targets from one codebase:

- **Node.js** — a self-hosted server bundle ideal for VPS, containers, and PaaS (Railway, Fly.io, Render).
- **Cloudflare Workers** — an edge bundle deployed via Wrangler; no cold-starts, global by default.
- **Static** — a pre-rendered site served via CDN; suitable for fully static content with no dynamic server logic.

The CLI performs consistent pre-build steps before any target ships:

1. Compiles Veil templates to TypeScript cache (`lumis view:cache`)
2. Builds the docs search index (`lumis search:build`)
3. Writes the route manifest (`lumis route:cache`)

<a name="build-targets"></a>
## Build targets

### Node.js

```shell
pnpm lumis build --target node
pnpm lumis preview --target node --port 4000
```

Generated output:

- `.arc/node/app.js` — the application bundle
- `.arc/.server.mjs` — the tiny Node.js HTTP adapter that imports the bundle

### Cloudflare Workers

```shell
pnpm lumis build --target cloudflare
```

Generated output: `.arc/cf-worker/worker.js`

Deploy via Wrangler:

```shell
pnpm exec wrangler deploy .arc/cf-worker/worker.js
```

### Static export

```shell
pnpm lumis build --target static
pnpm lumis preview --target static --port 4000
```

Generated output: `.arc/static/app.js` + `.arc/.server.mjs`

<a name="pre-deploy-checks"></a>
## Pre-deploy checks

Run diagnostics before shipping to catch missing artifacts and misconfigured environment:

```shell
pnpm lumis doctor   # checks env file, bootstrap, module structure, cache artifacts
pnpm lumis health   # verifies the running application can reach database and queue
pnpm test           # run the full test suite
```

These three commands should appear in every CI pipeline as blocking steps.

<a name="environment-variables"></a>
## Environment variables

Environment is validated at boot in `bootstrap/env.ts` via a Zod schema. Any missing or malformed variable causes a
clean process exit with a descriptive error before a single request is accepted.

**Production baseline** — the minimum variables every deployment requires:

```dotenv
# application
APP_ENV=production
APP_NAME=MyApp
APP_URL=https://myapp.example.com
APP_KEY=base64:...64-random-bytes...

# database
DB_URL=file:./database/production.sqlite3

# session
SESSION_DRIVER=redis
SESSION_SECRET=...long-random-secret...

# cache / queue
CACHE_DRIVER=redis
QUEUE_DRIVER=redis
REDIS_URL=redis://...
```

Never commit `.env` files. Use your host's secret manager (Fly secrets, Railway variables, Cloudflare Workers secrets) and
inject them at build or runtime.

<a name="deploying-to-nodejs-docker"></a>
## Deploying to Node.js (Docker)

### Dockerfile

```dockerfile
# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm lumis build --target node

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Only copy the built bundle, the server adapter, and runtime deps
COPY --from=builder /app/.arc  ./.arc
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

# Pass all secrets via environment variables — no .env file in the image
CMD ["node", "--env-file=/run/secrets/app.env", ".arc/.server.mjs"]
```

### docker-compose.yml (local / staging)

```yaml
version: "3.9"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      APP_ENV: production
      APP_URL: http://localhost:3000
      DB_URL: file:./database/app.sqlite3
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

Build and start:

```shell
docker compose up --build -d
docker compose exec app pnpm lumis db:migrate   # run migrations inside the container
```

<a name="running-with-pm2"></a>
## Running with PM2

PM2 is the recommended process manager for Node.js deployments outside of containers.

Install PM2 globally on the server:

```shell
npm install -g pm2
```

Create `ecosystem.config.cjs` at the project root:

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name:         'lumiarq-app',
      script:       '.arc/.server.mjs',
      instances:    'max',          // one worker per CPU core
      exec_mode:    'cluster',
      env_file:     '.env.production',
      max_memory_restart: '512M',
      error_file:   './logs/pm2-error.log',
      out_file:     './logs/pm2-out.log',
      merge_logs:   true,
    },
  ],
}
```

```shell
pm2 start ecosystem.config.cjs
pm2 save                           # persist across reboots
pm2 startup                        # register the PM2 daemon as a system service
```

View logs:

```shell
pm2 logs lumiarq-app
pm2 monit
```

<a name="nginx-reverse-proxy"></a>
## Nginx reverse proxy

Place Nginx in front of PM2 to handle TLS termination, gzip, and static asset caching:

```nginx
# /etc/nginx/sites-available/myapp
server {
    listen 80;
    server_name myapp.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name myapp.example.com;

    ssl_certificate     /etc/letsencrypt/live/myapp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.example.com/privkey.pem;

    # Forward real client IP so trust-proxies middleware sees it
    set_real_ip_from   0.0.0.0/0;
    real_ip_header     X-Forwarded-For;

    # Gzip
    gzip on;
    gzip_types text/html application/json application/javascript text/css;

    # Static assets served directly — bypass Node.js entirely
    location ~* \.(js|css|ico|png|svg|woff2)$ {
        root /var/www/myapp/public;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_read_timeout  60s;
        proxy_connect_timeout 5s;
    }
}
```

Reload Nginx after editing:

```shell
sudo nginx -t && sudo nginx -s reload
```

<a name="database-migrations-on-deploy"></a>
## Database migrations on deploy

Run migrations as a pre-start step, before traffic reaches the new server version. This ensures the schema is always
up to date when the application boots.

**CI pipeline step (Node.js / Docker):**

```shell
# Inside the container or on the server before starting the app
node --env-file=.env.production -e "
  const { runMigrations } = await import('@lumiarq/framework/db')
  await runMigrations()
  console.log('Migrations complete')
"
```

Or use the CLI:

```shell
APP_ENV=production pnpm lumis db:migrate
```

If you use Docker, run migrations in a separate `init-container` / `job` step in your orchestration manifest so migrating
and serving are decoupled:

```yaml
# docker-compose.yml
services:
  migrate:
    build: .
    command: ["node", "--env-file=/run/secrets/app.env", "-e", "import('@lumiarq/framework/db').then(m => m.runMigrations())"]
    depends_on:
      - app
```

<a name="health-check-endpoint"></a>
## Health check endpoint

Expose a `/health` route that your load balancer and orchestrator can poll. Return `200` when the application is healthy,
`503` otherwise.

```ts
// src/modules/System/http/routes/health.api.ts
import { Route } from '@lumiarq/framework'
import { HealthHandler } from '../handlers/health.handler'

Route.get('/health', HealthHandler, { name: 'system.health', render: 'static' })
```

```ts
// src/modules/System/http/handlers/health.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { checkDatabase } from '@modules/System/logic/queries/check-database.query'

export const HealthHandler = defineHandler(async (ctx) => {
  const db = await checkDatabase()

  if (!db.ok) {
    return ctx.json({ status: 'unhealthy', checks: { db } }, 503)
  }

  return ctx.json({
    status: 'ok',
    checks: { db },
    uptime: Math.floor(process.uptime()),
  })
})
```

Docker health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

<a name="deploying-to-cloudflare-workers"></a>
## Deploying to Cloudflare Workers

Create a `wrangler.toml` at the project root:

```toml
name        = "my-lumiarq-app"
main        = ".arc/cf-worker/worker.js"
compatibility_date = "2025-01-01"

[vars]
APP_ENV = "production"

# Store secrets via: pnpm exec wrangler secret put APP_KEY
```

Build and deploy:

```shell
pnpm lumis build --target cloudflare
pnpm exec wrangler deploy
```

Set production secrets without committing them:

```shell
pnpm exec wrangler secret put APP_KEY
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put DB_URL
```

<a name="github-actions-cicd-pipeline"></a>
## GitHub Actions CI/CD pipeline

A complete pipeline for a Dockerised Node.js deployment:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm lumis doctor

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: SSH and rolling restart
        uses: appleboy/ssh-action@v1
        with:
          host:     ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key:      ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            docker pull ghcr.io/${{ github.repository }}:latest
            docker compose -f /opt/myapp/docker-compose.yml up -d --no-deps app
            docker compose -f /opt/myapp/docker-compose.yml exec app \
              node --env-file=/run/secrets/app.env -e "
                const { runMigrations } = await import('@lumiarq/framework/db')
                await runMigrations()
              "
```

<a name="zero-downtime-deploy-with-pm2"></a>
## Zero-downtime deploy with PM2

PM2's cluster mode supports zero-downtime reloads. After pulling new code and rebuilding:

```shell
# Pull latest code and build
git pull origin main
pnpm install --frozen-lockfile
pnpm lumis build --target node

# Run migrations before reloading workers
APP_ENV=production pnpm lumis db:migrate

# Reload workers one at a time — no dropped connections
pm2 reload ecosystem.config.cjs --update-env
```

To automate this with a deploy script:

```shell
#!/usr/bin/env bash
# deploy.sh
set -euo pipefail

git pull origin main
pnpm install --frozen-lockfile
pnpm test
pnpm lumis build --target node
APP_ENV=production pnpm lumis db:migrate
pm2 reload ecosystem.config.cjs --update-env
pm2 save

echo "Deployment complete."
```

