---
title: lumis CLI
description: Practical reference for the lumis CLI in Lumiarq projects
section: Digging Deeper
order: 1
draft: false
---

# Lumis CLI

- [Introduction](#introduction)
- [Command groups](#command-groups)
- [Tinker](#tinker)
- [Notes on design direction](#notes-on-design-direction)
- [Writing Commands](#writing-commands)
  - [Multi-Value Arguments](#multi-value-arguments)
  - [Multi-Value Options](#multi-value-options)
  - [Input Descriptions](#input-descriptions)
  - [Prompting for Missing Input](#prompting-for-missing-input)
- [Command I/O](#command-io)
  - [Retrieving Input](#retrieving-input)
  - [Prompting for Input](#prompting-for-input)
  - [Asking for Confirmation](#asking-for-confirmation)
  - [Auto-Completion](#auto-completion)
  - [Multiple Choice Questions](#multiple-choice-questions)
- [Programmatically Executing Commands](#programmatically-executing-commands)
  - [Calling Commands From Other Commands](#calling-commands-from-other-commands)
- [Signal Handling](#signal-handling)
- [Stub Customization](#stub-customization)
- [Events](#events)

<a name="introduction"></a>

The lumis CLI is the operational surface for scaffolding, diagnostics, runtime tooling, and deployment workflows in Lumiarq.

Use it from a project root:

```shell
pnpm lumis help
```

<a name="command-groups"></a>
## Command groups

### Core utilities

```shell
pnpm lumis info
pnpm lumis health
pnpm lumis doctor
pnpm lumis module:list
```

- `info` prints framework/runtime details.
- `health` runs pre-flight checks before delegating to `lumis doctor`:
  - verifies `bootstrap/entry.ts`, `bootstrap/providers.ts`, and `config/app.ts` are present
  - checks that `@types/node` is installed
  - warns if `QUEUE_DRIVER=bullmq` but `bootstrap/worker.ts` is missing
  - warns if the route cache is stale
- `doctor` runs deeper project diagnostics (env vars, cache artifacts, module structure, bootstrap files).
- `module:list` shows discovered modules.

### Key and config tooling

```shell
pnpm lumis key:generate
pnpm lumis key:rotate
pnpm lumis config:show app
pnpm lumis config:show auth --json
```

- `key:generate` creates initial security keys.
- `key:rotate` rotates key material.
- `config:show` loads a config file from `config/<name>.ts`, redacts sensitive values, and prints it.

`config:show` supports TypeScript config files directly and falls back to `tsx` loading when needed.

### Scaffolding

```shell
pnpm lumis make:module Billing
pnpm lumis make:action Billing CreateInvoice
pnpm lumis make:query Billing GetInvoices
pnpm lumis make:handler Billing CreateInvoice
pnpm lumis make:task Billing SendInvoiceEmail
pnpm lumis make:repository Billing Invoice
pnpm lumis make:binding Billing Invoice
pnpm lumis make:factory Billing Invoice
pnpm lumis make:validator Billing CreateInvoice
pnpm lumis make:model Billing Invoice
pnpm lumis make:listener Billing InvoiceCreated
pnpm lumis make:policy Billing Invoice
pnpm lumis make:event Billing InvoiceCreated
pnpm lumis make:test Billing CreateInvoiceAction --unit
pnpm lumis make:route Billing --web --api
pnpm lumis make:command ReindexDocs
```

Use `stub:publish` if you want generated files customized by local project stubs.

### Database and routes

```shell
pnpm lumis db:generate
pnpm lumis db:migrate
pnpm lumis db:rollback --steps 1
pnpm lumis db:seed
pnpm lumis db:ping
pnpm lumis db:fresh
pnpm lumis db:reset
pnpm lumis db:studio
pnpm lumis db:status

pnpm lumis route:list
pnpm lumis route:check
pnpm lumis route:cache
pnpm lumis route:clear
```

- `db:generate` generates migration files from schema changes.
- `db:migrate` applies pending migrations.
- `db:rollback --steps 1` reverses the last N migrations.
- `db:seed` runs `src/shared/database/seeds/index.ts` (or the `db:seed` script in `package.json`).
- `db:ping` checks active database connectivity and prints actionable diagnosis when it fails.
- `db:fresh` pushes the schema (force), migrates, then seeds. **Use with care in production** — this is a destructive operation.
- `db:reset` drops all tables and re-runs migrations. Does **not** seed. Useful for a clean slate without test data.
- `db:studio` opens Drizzle Kit Studio in the browser for visual schema inspection and query editing.
- `db:status` reports which migrations have been applied.

### Config publishing

Scaffold typed configuration files into `config/` using `lumis publish config`:

```shell
pnpm lumis publish config mail
pnpm lumis publish config cache
pnpm lumis publish config all
pnpm lumis publish config list
pnpm lumis publish config mail --force
pnpm lumis config:cache
pnpm lumis config:clear
```

- `lumis publish config <name>` copies a freshly generated, typed config template to `config/<name>.ts`. The stub imports `env` from `bootstrap/env.ts` and uses the `as const` pattern.
- Available names: `mail`, `queue`, `cache`, `storage`, `session`, `security`, `logging`, `auth`.
- `lumis publish config all` publishes all eight config files at once — useful when bootstrapping a new project.
- `lumis publish config list` shows which configs are available and which are already present in `config/`.
- `--force` overwrites an existing file. Without it, `publish config` skips files that already exist and prints a notice.
- `config:cache` resolves all project config files and writes a cached artifact.
- `config:clear` removes the config cache artifact.

See the [Configuration](/docs/configuration#publishing-config-files) documentation for the full stub format for each file.

### Worker commands

```shell
pnpm lumis worker:start
pnpm lumis worker:start --dev
pnpm lumis worker:list
```

- `worker:start` starts the background worker process. In production this runs `.arc/node/worker.js` — the compiled worker bundle.
- `worker:start --dev` runs `bootstrap/worker.ts` directly via `tsx`, watching for file changes. Use this during local development.
- `worker:list` lists running worker processes and all registered scheduled jobs with their cron expressions and last/next run times.

The worker process is separate from the HTTP server. Both can run concurrently. See [Workers](/docs/workers) for the full setup guide.

### Schedule commands

```shell
pnpm lumis schedule:list
pnpm lumis schedule:run <name>
```

- `schedule:list` prints all cron jobs registered in `bootstrap/schedule.ts`, including their schedule expression and next calculated run time.
- `schedule:run <name>` triggers a named scheduled job immediately, bypassing its cron timer. Useful for manual testing or one-off execution without waiting for the next scheduled window.

### Views and search index

```shell
pnpm lumis view:cache
pnpm lumis view:clear
pnpm lumis search:index
pnpm lumis search:clear
```

`search:index` scans docs content from either:

- `content/docs/`
- `src/shared/database/content/docs/`

Draft docs (`draft: true`) are skipped.

### Optimize for production

```shell
pnpm lumis optimize
pnpm lumis optimize:clear
```

- `optimize`
- `optimize:clear`

- `optimize` runs `config:cache`, `route:cache`, `view:cache`, and `search:index` in one command.
- `optimize:clear` runs `config:clear`, `route:clear`, `view:clear`, and `search:clear` in one command.

### Runtime and deployment
```shell
pnpm lumis serve
pnpm lumis build --target node
pnpm lumis build --target cloudflare
pnpm lumis build --target static
pnpm lumis preview --target node
pnpm lumis preview --target static
pnpm lumis preview --target cloudflare
```

- `serve` compiles views, caches routes, bundles node output, and starts dev server with `node --watch`.
- `build` always compiles views, builds search index, and caches routes before bundling target output.
- `preview --target cloudflare` prints deployment guidance; local node preview is for `node` and `static` targets.

### Maintenance and auth

```shell
pnpm lumis down --message "Scheduled maintenance"
pnpm lumis up
pnpm lumis auth:install
pnpm lumis auth:install --iam
pnpm lumis auth:install --ui react
pnpm lumis stub:publish --all
```

### About the wrapper layer

When you run `pnpm lumis` from a Lumiarq app, you're using the `@illumiarq/lumis` wrapper package, which extends the base `@lumiarq/lumis` CLI with app-specific commands.

The wrapper **intercepts** LumiARQ app commands locally (runtime + app tooling), including:

- `serve` — compiles views, caches routes, bundles output, starts dev server
- `build` — with optional `--target` flag (node, cloudflare, static)
- `preview` — with optional `--target` flag (node, cloudflare, static)
- `route:*`, `view:*`, `search:*`, `optimize*`
- `db:*`, `worker:*`, `schedule:*`
- `auth:install`, `stub:publish`, `publish config`

Core lumis commands (doctor, make, intent, ir, runtime, tinker, etc.) are still delegated to the base `@lumiarq/lumis` CLI.

Project custom commands can be run in two ways:

```shell
pnpm lumis commands run project docs:reindex
pnpm lumis docs:reindex
```

Direct invocation (`pnpm lumis <name>`) works for commands defined in `projectCommands` and does not override built-in wrapper/core command names.

**Flag shortcuts for runtime commands:**

```shell
# All equivalent — use whichever feels natural
pnpm lumis build --target static
pnpm lumis build --to static
pnpm lumis build --t static
pnpm lumis build -t static

# Port and host shortcuts for serve
pnpm lumis serve --port 4000 --host 0.0.0.0
pnpm lumis serve -p 4000 -H 0.0.0.0
```

For `preview` and `build`, when target is `node`, the wrapper handles the flow locally. For `static` and `cloudflare`, the wrapper delegates to pnpm run scripts (e.g., `build:static`, `build:cloudflare`) defined in your `package.json`.

<a name="tinker"></a>
## Tinker

`pnpm lumis tinker` starts an interactive REPL and attempts to load app context from compiled bootstrap artifacts.

Typical workflow:

```shell
pnpm lumis build --target node
pnpm lumis tinker
```

Inside tinker, available bindings may include:

- `env`
- named exports from `bootstrap/providers`

If context is not loaded, tinker prints guidance and still starts as a plain REPL.

<a name="notes-on-design-direction"></a>
## Notes on design direction

- Lumis is command-first and file-convention based.
- Commands are plain TypeScript modules — no IoC container, no magic resolution.
- Command behavior should stay explicit and TypeScript-native as v2 evolves.

<a name="writing-commands"></a>
## Writing Commands

Commands are TypeScript modules defined with `defineCommand` and placed under a module's `http/commands/` directory. Lumis discovers and registers them at boot based on file conventions.

```ts
// src/modules/Docs/http/commands/reindex-docs.command.ts
import { defineCommand } from '@lumiarq/framework'

export const ReindexDocsCommand = defineCommand({
  name: 'docs:reindex',
  description: 'Rebuild the documentation search index',
  args: {
    version: { type: 'string', description: 'Docs version to index', optional: true },
  },
  flags: {
    force: { type: 'boolean', description: 'Force full rebuild', default: false },
  },
  async run({ args, flags }) {
    const version = args.version ?? '1.x'
    const { force } = flags
    // ... implementation
  },
})
```

Run it with:

```shell
pnpm lumis docs:reindex 1.x --force
```

<a name="multi-value-arguments"></a>
### Multi-Value Arguments

To accept multiple values for a single argument, set its type to `string[]`:

```ts
export const MailSendCommand = defineCommand({
  name: 'mail:send',
  description: 'Send mail to one or more users',
  args: {
    users: { type: 'string[]', description: 'User IDs to send mail to' },
  },
  async run({ args }) {
    for (const userId of args.users) {
      // send mail to userId
    }
  },
})
```

Invoke with space-separated values:

```shell
pnpm lumis mail:send 1 2 3
```

To make the list optional (zero or more), mark it `optional: true`:

```ts
args: {
  users: { type: 'string[]', description: 'User IDs', optional: true },
},
```

<a name="multi-value-options"></a>
### Multi-Value Options

Flags that accept multiple values use the same `string[]` type under `flags`:

```ts
export const MailSendCommand = defineCommand({
  name: 'mail:send',
  description: 'Send mail to selected IDs',
  flags: {
    id: { type: 'string[]', description: 'IDs to include' },
  },
  async run({ flags }) {
    for (const id of flags.id ?? []) {
      // process id
    }
  },
})
```

Pass multiple values by repeating the flag:

```shell
pnpm lumis mail:send --id=1 --id=2
```

<a name="input-descriptions"></a>
### Input Descriptions

Every `args` and `flags` entry accepts a `description` field. These descriptions appear in `--help` output automatically:

```ts
export const MailSendCommand = defineCommand({
  name: 'mail:send',
  description: 'Send a queued mail to a user',
  args: {
    user: { type: 'string', description: 'The ID of the user to mail' },
  },
  flags: {
    queue: { type: 'boolean', description: 'Whether to queue the job', default: false },
  },
  async run({ args, flags }) {
    // ...
  },
})
```

```shell
pnpm lumis mail:send --help
```

<a name="prompting-for-missing-input"></a>
### Prompting for Missing Input

When a required argument is missing, you can prompt for it inside `run()` using `@clack/prompts`:

```ts
import { defineCommand } from '@lumiarq/framework'
import { text } from '@clack/prompts'

export const MailSendCommand = defineCommand({
  name: 'mail:send',
  description: 'Send mail to a user',
  args: {
    user: { type: 'string', description: 'The ID of the user', optional: true },
  },
  async run({ args }) {
    const userId = args.user ?? await text({
      message: 'Which user ID should receive the mail?',
      placeholder: 'e.g. 123',
    })

    // proceed with userId
  },
})
```

For a searchable list, use `@clack/prompts`'s `select` or a compatible search prompt:

```ts
import { select } from '@clack/prompts'

const userId = args.user ?? await select({
  message: 'Select a user:',
  options: users.map(u => ({ value: u.id, label: u.name })),
})
```

> [!NOTE]
> See the [LumiARQ Prompts](/docs/{{version}}/prompts) documentation for the full list of available prompt types.

<a name="command-io"></a>
## Command I/O

<a name="retrieving-input"></a>
### Retrieving Input

Arguments and flags are destructured directly from the `run()` context. They are fully typed based on your `args` and `flags` definitions:

```ts
export const MailSendCommand = defineCommand({
  name: 'mail:send',
  args: {
    user: { type: 'string', description: 'User ID' },
  },
  flags: {
    queue: { type: 'string', description: 'Queue name', default: 'default' },
  },
  async run({ args, flags }) {
    const userId = args.user       // string
    const queueName = flags.queue  // string

    // ...
  },
})
```

All defined `args` and `flags` are available in the `run` context — no separate getter methods needed. Optional values will be `undefined` if not provided.

<a name="prompting-for-input"></a>
### Prompting for Input

> [!NOTE]
> LumiARQ commands use [`@clack/prompts`](https://github.com/natemoo-re/clack) for interactive CLI input — a standard Node.js prompts library with a clean, composable API.

Use `text` to ask the user for a free-form string:

```ts
import { defineCommand } from '@lumiarq/framework'
import { text } from '@clack/prompts'

export const ExampleCommand = defineCommand({
  name: 'example',
  async run() {
    const name = await text({
      message: 'What is your name?',
      placeholder: 'e.g. Alex',
    })

    // ...
  },
})
```

For sensitive input such as passwords, use `password`:

```ts
import { password } from '@clack/prompts'

const secret = await password({ message: 'Enter your password:' })
```

<a name="asking-for-confirmation"></a>
#### Asking for Confirmation

Use `confirm` from `@clack/prompts` for yes/no prompts. It returns `true` or `false`:

```ts
import { confirm } from '@clack/prompts'

const proceed = await confirm({ message: 'Do you wish to continue?' })

if (proceed) {
  // ...
}
```

To default to `true`:

```ts
const proceed = await confirm({ message: 'Do you wish to continue?', initialValue: true })
```

<a name="auto-completion"></a>
#### Auto-Completion

For auto-completing input from a known list, use `select` or pass a custom list via `text`'s `suggest` option if supported by your prompt library. `select` presents a fixed list of choices:

```ts
import { select } from '@clack/prompts'

const env = await select({
  message: 'Select deployment environment:',
  options: [
    { value: 'production', label: 'Production' },
    { value: 'staging', label: 'Staging' },
    { value: 'development', label: 'Development' },
  ],
})
```

<a name="multiple-choice-questions"></a>
#### Multiple Choice Questions

For multi-select (choosing more than one option from a list), use `multiselect`:

```ts
import { multiselect } from '@clack/prompts'

const modules = await multiselect({
  message: 'Which modules should be seeded?',
  options: [
    { value: 'billing', label: 'Billing' },
    { value: 'auth', label: 'Auth' },
    { value: 'docs', label: 'Docs' },
  ],
  required: false,
})
```

LumiArq discovers command files from the framework conventions used by your project scaffold and registers them at boot. Commands are plain TypeScript modules resolved through explicit imports and runtime bootstrapping.

<a name="programmatically-executing-commands"></a>
## Programmatically Executing Commands

Programmatic command execution APIs are being formalized for v2. For now, prefer one of these approaches:

- Execute commands from the terminal with pnpm lumis.
- Extract reusable logic into actions and tasks, then call those directly from handlers, jobs, or schedules.
- Keep CLI commands as thin wrappers around reusable action/task logic.

<a name="calling-commands-from-other-commands"></a>
### Calling Commands From Other Commands

In LumiArq, command-to-command orchestration should generally happen through shared domain logic instead of command chaining. Place shared behavior in actions/tasks and invoke that shared logic from each command.

<a name="signal-handling"></a>
## Signal Handling

Operating systems send signals to running processes to request termination or other lifecycle changes. To handle signals in a long-running Lumis command, use Node.js's built-in `process.on`:

```ts
export const WorkerCommand = defineCommand({
  name: 'queue:work',
  description: 'Process queued jobs',
  async run() {
    let running = true

    process.on('SIGTERM', () => {
      running = false
    })

    while (running) {
      // process next job
    }
  },
})
```

To handle multiple signals:

```ts
process.on('SIGTERM', () => { running = false })
process.on('SIGQUIT', () => { running = false })
```

Or with a shared handler:

```ts
const stop = () => { running = false }

process.on('SIGTERM', stop)
process.on('SIGQUIT', stop)
```

<a name="stub-customization"></a>
## Stub Customization

The Lumis console's `make` commands generate files using "stub" templates populated with values based on your input. To customize the output of generated files, publish the stubs to your project:

```shell
pnpm lumis stub:publish
```

The published stubs will be located within a `stubs` directory in the root of your application. Any changes you make to these stubs will be reflected when you generate their corresponding files using Lumis's `make` commands.

<a name="events"></a>
## Events

Command lifecycle events (`CommandStarting`, `CommandFinished`) are planned for v2.