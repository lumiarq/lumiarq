# Architectural Decisions — lumiarq

## 2026-05-13 — Replace `app()` helper with `env.APP_ENV` in config files

**Context**: `@lumiarq/framework` does not export an `app` helper. The config files
`logging.ts`, `session.ts`, and `database.ts` were calling `app().isProduction()` and
`app().isLocal()` which threw at bundle time.

**Decision**: Read `APP_ENV` directly from the validated `env` object imported from
`@/bootstrap/env`. This is consistent with the framework's documented pattern
(`usePublicEnv` / validated env schema) and avoids any runtime dependency on an
application context that is not yet initialized during config evaluation.

**Non-goal**: We did not add `app()` to `@lumiarq/framework` — that would couple
config evaluation to the boot lifecycle and cause circular dependency risk.

---

## 2026-05-13 — `--packages=external` on `build:vercel-bundle`

**Context**: esbuild was bundling `argon2` (a native Node.js addon) into `api/index.js`,
causing a crash at Vercel serverless function startup.

**Decision**: Add `--packages=external` to the `build:vercel-bundle` esbuild command.
This makes all `node_modules` external — Vercel installs them natively at deploy time.
This is the correct strategy for any bundle that targets a Node.js serverless runtime
that provides `node_modules` separately.

**Open risk**: If a dependency is not available in the Vercel Node.js environment, it
will throw at runtime rather than build time. Monitor `vercel deploy` logs for
`Cannot find module` errors after adding new dependencies.

---

## Next action
Start Wave 1 — run `lumiarq-wave1-baseline-hardening` skill.
