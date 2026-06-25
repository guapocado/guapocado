# @guapocado/cli

CLI for the Guapocado billing platform. Manage billing configs, sync with Stripe, and generate typed code from your billing schema.

## Install

```bash
npm install -g @guapocado/cli
```

## Authentication

```bash
guap login
guap login --sandbox
guap login --production
```

The CLI starts a browser/device-code flow and stores the approved target credentials in
`.guapocado/credentials.json` under the directory where you run `guap login`.

For CI escape hatches, an existing server key can still be saved directly:

```bash
guap login --sandbox --key sk_guap_test_...
```

## Commands

### `guap init`

Scaffold a `billing.config.ts` in the current directory with example plans and entitlements.

```bash
guap init
```

### `guap push`

Push your local billing config to the Guapocado platform and sync to Stripe.

```bash
guap push
guap push --sandbox
guap push --production
```

### `guap pull`

Pull the current billing config from the platform and write to `billing.config.json`.

```bash
guap pull
guap pull --env production
```

### `guap diff`

Show what would change between your local config and the remote config.

```bash
guap diff
```

### `guap plan`

Preview what a `push` would do without making changes. Like `terraform plan` for billing.

```bash
guap plan
```

### `guap generate`

Generate TypeScript types, OpenAPI specs, and tRPC router code from your billing config.
`billing.config.ts` is the default project source when present, followed by
`billing.config.json`, `guapocado.billing.json`, and `guapocado.billing.yaml`.

```bash
guap generate
```

Outputs:
- `billing.generated.ts` - TypeScript types for entitlement keys, product keys, and Guapocado entitlements
- `billing.openapi.json` - OpenAPI 3.0 spec
- `billing.router.ts` - tRPC router code using the `guap` namespace

Managed Edge API mode is the default deployment mode. In that mode, your app
calls the Guapocado edge-backed API through `@guapocado/sdk`, and
`guap generate` only needs to write typed helpers and integration artifacts.

Local read-model mode is optional. In that mode, Guapocado forwards billing
events to your app, your webhook receiver projects those events into local
Guapocado server SDK tables, and app-owned hot paths can query local customer,
subscription, and entitlement state. Generate tables only for this mode.

In both modes, authoritative writes and commands go through the Guapocado API.
Local read-model mode only changes where your app can read projected customer,
subscription, and entitlement state. When an `adapter` is configured,
SDK reads check the local read model first, fall back to the API on a miss or
adapter error, and invoke the adapter's `trueUp` hook with the API result.
SDK command methods remain API-backed.

Generate server SDK database tables and adapter shim for these targets:

- ORM: `drizzle`
- Dialects: `sqlite`, `pg`, `mysql`
- Generated adapter shim: `createGuapDrizzleAdapter(db)`

Dialect aliases accepted by the CLI:

- `sqlite`: `sqlite`, `sqlite3`, `libsql`, `turso`, `d1`
- `pg`: `pg`, `pgsql`, `postgres`, `postgresql`
- `mysql`: `mysql`, `mysql2`, `mariadb`, `planetscale`

```bash
guap generate --tables --orm drizzle --db sqlite
guap generate --tables --orm drizzle --db pg
guap generate --tables --orm drizzle --db mysql
```

You can also store table generation defaults in `billing.config.ts`:

```ts
import { defineBilling } from "@guapocado/shared";

export default defineBilling({
  entitlements: {
    seats: { type: "limit" },
  },
  products: [
    {
      key: "pro",
      entitlements: {
        seats: { included: 10 },
      },
    },
  ],
  generate: {
    tables: {
      enabled: true,
      orm: "drizzle",
      db: "sqlite",
      output: "guapocado.drizzle.sqlite.ts",
    },
  },
});
```

CLI flags override the config for a single run:

```bash
guap generate --db pg
guap generate --tables --orm drizzle --db mysql --table-output schema/guapocado.ts
```

Table generation writes `guapocado.drizzle.<db>.ts` by default. The generated
file exports prefixed table definitions such as `guapocado_customers`,
`guapocado_subscriptions`, `guapocado_purchases`,
`guapocado_purchase_grants`, and `guapocado_usage_events`, plus
`createGuapDrizzleAdapter(db)` for local-first SDK reads.

Guapocado forwards domain snapshot events, not raw Stripe webhooks. Generated
webhook event tables include source metadata columns so receivers can store
events such as `purchase.completed` and `entitlements.updated` while keeping
Stripe event IDs internal.

If you only generate tables, a billing config is not required:

```bash
guap generate --tables --orm drizzle --db sqlite --output src/db
```

Products in `billing.config.ts` use explicit pricing modes:

- `pricing.mode: "recurring"` with `frequency: "month" | "year"` for subscription checkout.
- `pricing.mode: "one_time"` with no frequency for payment checkout.

`pricing.interval` is still read as a temporary recurring compatibility alias,
but `guap pull --format ts` writes `frequency`.

### `guap listen`

Start the development webhook relay and forward approved Guapocado events to the
local app. Use this for local read-model mode and framework integrations that
need forwarded Guapocado events.

```bash
guap listen
```

## Environments

Use sandbox and production targets for config pushes:

```bash
guap login --sandbox
guap login --production
guap push --sandbox
guap push --production
```

Credentials are stored in project-local `.guapocado/credentials.json`; treat
that file as CLI-owned.
