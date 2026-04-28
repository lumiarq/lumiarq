---
title: Installation
description: Install Lumiarq and set up your development environment
section: Getting Started
order: 1
draft: false
---

# Installation

- [Meet LumiARQ](#meet-lumiarq)
    - [Why LumiARQ?](#why-lumiarq)
- [Creating a LumiARQ Application](#creating-a-lumiarq-project)
    - [Prerequisites](#prerequisites)
    - [Creating an Application](#creating-an-application)
- [Initial Configuration](#initial-configuration)
    - [Environment Based Configuration](#environment-based-configuration)
    - [Databases and Migrations](#databases-and-migrations)
    - [Directory Configuration](#directory-configuration)
- [Installation Using Herd](#installation-using-herd)
    - [Herd on macOS](#herd-on-macos)
    - [Herd on Windows](#herd-on-windows)
- [IDE Support](#ide-support)
- [LumiARQ and AI](#lumiarq-and-ai)
    - [Installing LumiARQ Boost](#installing-lumiarq-boost)
- [Next Steps](#next-steps)
    - [LumiARQ the Full Stack Framework](#lumiarq-the-fullstack-framework)
    - [LumiARQ the API Backend](#lumiarq-the-api-backend)

---

<a name="meet-lumiarq"></a>
## Meet LumiARQ

LumiARQ is a TypeScript web application framework that provides your with structure and starting point for creating your application, allowing you to focus on creating what you love while we do the magic.

LumiARQ is shipped with powerful features such as an expressive database abstraction layer, queues and scheduled jobs, unit and integration testing, and more just for you to have an amazing experience using the framework as a developer.

Whether you are an experience developer or new to TypeScript web frameworks, LumiARQ is a framework that can grow with you. We'll help you take your first steps as a web developer or give you a boost as you take your expertise to the next level. We can't wait to see what you build.

<a name="why-lumiarq"></a>
### Why LumiARQ?

There are a variety of tools and frameworks available to you when building a web application. However, we believe LumiARQ is the best choice for building modern, full-stack web applications.

#### A Progressive Framework

We like to call LumiARQ a "progressive" framework. By that, we mean that LumiARQ grows with you. If you're just taking your first steps into web development, LumiARQ's vast library of documentation, guides, and [video tutorials](https://laracasts.com) will help you learn the ropes without becoming overwhelmed.

If you're a senior developer, LumiARQ gives you robust tools for unit testing, queues, scheduled jobs, module-level architecture boundaries, and type-safe contracts. LumiARQ is tuned for professional web applications and enterprise workloads.

#### A Scalable Framework

LumiARQ is highly scalable. With explicit module boundaries, worker-friendly architecture, and deployment support for Node.js and Cloudflare Workers, applications can scale horizontally without forcing an IoC-heavy runtime model.

Need extreme scaling? Deploy behind standard cloud primitives such as serverless workers, managed containers, and load-balanced Node services.


## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20 or later.** Lumiarq uses native ES modules and requires the Node.js 20+ module resolution behaviour. Check your version with `node --version`.
- **pnpm 9 or later.** The framework's internal monorepo and the generated project scaffolds use pnpm workspaces. Install it with `npm install -g pnpm` or via [pnpm's official installer](https://pnpm.io/installation). Check your version with `pnpm --version`.

---

## Creating a new project

The fastest way to start is with the `create-lumiarq-app` initialiser:

```shell
npm create lumiarq-app@latest
```

This command is intentionally run with `npm create` so that the initialiser itself does not need to be installed globally. You will be prompted for a project name and a preset:

```shell
? Project name: my-app
? Preset:
  > api-only       API with JWT authentication
    full-stack     API + server-rendered pages
    domain-only    Domain logic only, no HTTP layer
```

Once you confirm, the initialiser scaffolds your project, installs dependencies, and generates `.env` from `.env.example`. You can also pass arguments directly:

```shell
npm create lumiarq-app@latest my-app --preset api-only
```

After the project is created, enter the directory:

```shell
cd my-app
```

---

## Project structure

A freshly generated project looks like this:

```shell
my-app/
├── bootstrap/
│   ├── env.ts          # Zod-validated environment variables
│   ├── providers.ts    # Service provider registration
│   └── schedule.ts     # Scheduled job registration
├── config/
│   ├── app.ts
│   ├── auth.ts
│   ├── cache.ts
│   ├── database.ts
│   ├── logging.ts
│   ├── mail.ts
│   ├── queue.ts
│   ├── security.ts
│   ├── session.ts
│   └── storage.ts
├── content/            # Markdown content files (optional)
├── lang/
│   └── en.json         # Translation strings
├── src/
│   └── modules/
│       └── Welcome/
│           ├── module.ts
│           └── http/
│               └── welcome.web.ts
├── .env
├── .env.example
├── package.json
└── tsconfig.json
```

The heart of your application lives in `src/modules/`. Each subdirectory is a self-contained module that owns its own HTTP layer, business logic, and data access. The `bootstrap/` and `config/` directories are framework-level concerns that you configure once and rarely touch after initial setup.

---

## Environment setup

Open `.env` and verify the essential variables:

```shell
APP_NAME="My App"
APP_ENV=local
APP_URL=http://localhost:4000
APP_DEBUG=true

DATABASE_URL=file:./database/app.db
```

The `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, and `SESSION_SECRET` fields are required for authentication. If they are not already populated (the initialiser fills them when it runs `key:generate`), generate them now:

```shell
pnpm lumis key:generate
```

This generates a 4096-bit RS256 key pair and a cryptographically random 32-byte session secret, writing them to `.env` with `0600` file permissions.

All environment variables are validated at startup by `bootstrap/env.ts` using Zod. If a required variable is missing or malformed, the application refuses to start and prints a clear error listing the offending fields.

---

## Starting the development server

```shell
pnpm lumis serve
```

The development server starts at `http://localhost:4000`. It watches your source files and reloads on changes.

You should see output similar to:

```
  Lumiarq  v0.1.0
  Local:   http://localhost:4000
  Network: http://192.168.1.10:4000

  ready in 312ms
```

To use a different port, pass the `--port` flag or set the `PORT` environment variable:

```shell
pnpm lumis serve --port 4000
# or
PORT=4000 pnpm lumis serve
```

---

## Building for production

Lumiarq supports three deployment targets. Choose the one that matches your infrastructure:

```shell
# Node.js server (Express-compatible adapter)
pnpm lumis build --target node

# Cloudflare Workers
pnpm lumis build --target cloudflare

# Static site export
pnpm lumis build --target static
```

The build output is written to the `.arc/` directory at the project root. You can preview the production build locally before deploying:

```shell
pnpm lumis preview --target node --port 4000
```

The default port for both `serve` and `preview` is `4000` when `PORT` is not set.

---

## Verifying the installation

After the server starts, open your browser at `http://localhost:4000`. The generated Welcome module registers a route at `/` that returns a simple response confirming the framework is running.

You can also run the built-in diagnostics command:

```shell
pnpm lumis info
```

This prints the framework version, Node.js version, runtime adapter, and current environment:

```
Lumiarq v0.1.0
Node.js v22.4.0 (darwin)
Adapter: node
Environment: local
```

---

## Next steps

With your project running, the following guides cover the next steps in building your application:

- [Configuration](/docs/configuration) — understand and customise the 10 config files
- [Modules](/docs/modules) — learn how the module system structures your application
- [Routing](/docs/routing) — declare routes with the `Route` DSL
- [CLI Reference](/docs/lumis-cli) — full reference for all `lumis` commands
- [Authentication](/docs/authentication) — scaffold and extend auth flows with `lumis auth:install`
