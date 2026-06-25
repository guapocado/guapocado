# Guapocado Examples

These examples are CI fixtures as much as demos. They exercise the public package
layers and can also be used to run the full local DX flow.

- `hono-app`: server/edge example using `@guapocado/hono`.
- `react-app`: React provider, hooks, and HOC example using `@guapocado/react`.
- `better-auth-app`: Next.js + Better Auth + Drizzle example using `@guapocado/better-auth`.

Run all examples:

```bash
pnpm typecheck:examples
pnpm build:examples
pnpm dx:examples
```

## DX Flow

Log in to the hosted sandbox from an example directory:

```bash
pnpm guap:login:sandbox
```

Then run the flow from any example directory:

```bash
pnpm exec guap init
pnpm guap:plan:sandbox
pnpm guap:push:sandbox
pnpm dev
```

`guap:init` is safe to run in these examples: each example already has a
`billing.config.ts`, so the CLI will warn instead of overwriting it. The plan and push
commands use that file.

## Pointing at Hosted Guapocado

There are two independent URLs:

- CLI URL: where `guap plan` and `guap push` send config.
- App URL: where the running example sends SDK requests.

For a copied examples repo demonstrating the hosted platform:

```bash
pnpm guap:login:sandbox
cp .env.example .env
```

Bare `guap ...` only works after a global install or shell link. Inside these examples,
use `pnpm exec guap ...` for ad hoc commands or the `pnpm guap:*` scripts for the
common flow.

When these examples are copied out of the monorepo, replace `workspace:*` package
versions with published package versions, for example:

```json
{
  "@guapocado/react": "^0.0.1",
  "@guapocado/better-auth": "^0.0.1",
  "@guapocado/cli": "^0.0.1"
}
```

## Example Apps

### `hono-app`

Uses `@guapocado/hono` and runs on Wrangler.

```bash
cp .dev.vars.example .dev.vars
pnpm dev
```

### `react-app`

Uses `@guapocado/react` and runs on Vite. It exercises `GuapocadoProvider`,
`useGuapocado()`, `useEntitlement()`, `useUsageBalance()`, `useLimit()`, and `withGuapocado()`.

```bash
cp .env.example .env
pnpm dev
```

### `better-auth-app`

Uses Next.js, Better Auth, Drizzle, and `@guapocado/better-auth`. The app signs users in
with Better Auth, stores auth data in SQLite through Drizzle, ensures a Guapocado
customer for the signed-in user, checks `advanced-analytics`, and consumes `api-calls`.
The UI uses `guapocadoClient()` from `@guapocado/better-auth/client` so browser code calls
typed Guapocado methods on the Better Auth client.

```bash
cp .env.example .env
pnpm dev
```
