# @guapocado/sdk

TypeScript SDK for the Guapocado billing platform. Works in Node.js, edge runtimes, and browsers.

## Install

```bash
npm install @guapocado/sdk
```

## Quick start

```typescript
import { createGuapocadoClient } from "@guapocado/sdk";

const guap = createGuapocadoClient({
  apiKey: "sk_guap_test_...",
  customerId: "org_123",
});

// Check a feature entitlement
const canUseFeature = await guap.has("advanced-analytics");

// Check usage balance
const apiCalls = await guap.usage.balance("api-calls");

// Consume or refund credits
const updated = await guap.usage.consume("api-calls", 1);
const refunded = await guap.usage.refund("api-calls", 1);

// Retry-safe consumption: pass an idempotency key so a retried call (timeout,
// queue redelivery) is applied at most once.
await guap.usage.consume("api-calls", 1, { idempotencyKey: requestId });

// Enable paid overage for a customer when the plan allows it
await guap.usage.configure("api-calls", { overageEnabled: true });

// Check an effective limit
const seats = await guap.limit("seats");

// Store purchased expansion for a limit
await guap.limits.configure("seats", {
  purchased: 3,
  autoExpansionEnabled: false,
});

// Fetch a consolidated context for a page/API route
const context = await guap.context({
  features: ["advanced-analytics"],
  usage: ["api-calls"],
  limits: ["seats"],
});
```

You can also pass `customerId` per call:

```typescript
await guap.has("advanced-analytics", { customerId: "team_123" });
await guap.usage.balance("api-calls", { customerId: "team_123" });
await guap.usage.consume("api-calls", 1, { customerId: "team_123" });
await guap.limit("seats", { customerId: "team_123" });
```

`customerId` is the stable entity your app wants to bill. It can be a user ID,
organization ID, team ID, workspace ID, project ID, account ID, or a dedicated
Guapocado customer ID if you store one.

## Deployment modes

Guapocado supports two server-side deployment modes.

### Managed Edge API mode

Managed Edge API mode is the default. Your app uses `@guapocado/sdk` to call the
Guapocado edge-backed API for entitlement checks, usage reads, usage writes,
checkout, customer updates, subscription changes, and webhook registration.

Use this mode when you want the smallest integration surface:

- No Guapocado tables in your app database.
- No local billing read model to maintain.
- Runtime reads use the managed Guapocado API surface, including cache-backed
  entitlement paths.

### Local read-model mode

Local read-model mode keeps a local projection of Guapocado server SDK data in
your app database. Guapocado forwards billing events to your app, and your
webhook receiver projects those events into local tables such as customers,
subscriptions, purchases, purchase grants, entitlement definitions, customer
entitlements, usage events, invoices, and webhook deliveries.

Use this mode when hot-path reads should avoid an API round trip:

- Generate Guapocado server SDK table definitions for ORM `drizzle`.
- Use dialect `sqlite`, `pg`, or `mysql`.
- Run the generated tables through your app's normal migration workflow.
- Register a webhook receiver so Guapocado can forward customer, subscription,
  purchase, entitlement, usage, invoice, and webhook delivery events.
- Query the generated tables from your app for local customer, subscription, and
  entitlement reads.

In both modes, authoritative writes and commands go through the Guapocado API:
usage consumption/refunds, usage and limit settings, customer sync, checkout,
subscription changes, webhook registration, and config push. Local read-model
mode only changes where your app can read projected customer, subscription, and
entitlement state.

When an `adapter` is configured, SDK read methods such as
`guap.has("advanced-analytics")`, `guap.limit("seats")`, and
`guap.usage.balance("api-calls")` query the local read model first. A miss or
adapter error falls back to the Guapocado API, then invokes the adapter's
`trueUp` hook with the API result so the local projection can catch up. SDK
command methods remain API-backed.

The local read model is event-fed, so design handlers to be idempotent and allow
for eventual consistency.

## Local read-model tables

Use the CLI to generate Guapocado server SDK table definitions for these
targets:

- ORM: `drizzle`
- Dialects: `sqlite`, `pg`, `mysql`
- Generated adapter shim: `createGuapDrizzleAdapter(db)`

Dialect aliases accepted by the CLI:

- `sqlite`: `sqlite`, `sqlite3`, `libsql`, `turso`, `d1`
- `pg`: `pg`, `pgsql`, `postgres`, `postgresql`
- `mysql`: `mysql`, `mysql2`, `mariadb`, `planetscale`

```bash
npx guap generate --tables --orm drizzle --db sqlite
npx guap generate --tables --orm drizzle --db pg
npx guap generate --tables --orm drizzle --db mysql
```

You can also keep table generation defaults in `billing.config.ts`:

```typescript
import { defineBilling } from "@guapocado/sdk";

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
      output: "src/db/guapocado.ts",
    },
  },
});
```

Flags override the config for one run:

```bash
npx guap generate --db pg
```

These generated tables are for local read-model mode. Managed Edge API mode does
not need them. Better Auth users should keep using Better Auth's generator for
auth and plugin tables.

Configure the generated Drizzle adapter to make SDK reads local-first:

```typescript
import { createGuapocadoClient } from "@guapocado/sdk";
import { createGuapDrizzleAdapter } from "./db/guapocado";

const guap = createGuapocadoClient({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  customerId: "org_123",
  adapter: createGuapDrizzleAdapter(db),
});
```

If you use raw SQL or an ORM without a generated shim, implement `GuapAdapter`:

```typescript
import { type GuapAdapter, createGuapocadoClient } from "@guapocado/sdk";

type Query = <T>(sql: string, params: unknown[]) => Promise<T[]>;

function createSqlGuapAdapter(query: Query): GuapAdapter {
  return {
    async has({ customerId, key }) {
      const [entitlement] = await query<{ value_bool: number }>(
        [
          "select value_bool from guapocado_customer_entitlements",
          "where customer_id = ? and key = ? and type = 'feature'",
        ].join(" "),
        [customerId, key],
      );
      if (!entitlement) return { found: false };
      return { found: true, value: entitlement.value_bool === 1 };
    },
    async trueUp(event) {
      if (event.operation === "has") {
        await upsertLocalFeatureEntitlement(event.customerId, event.key, event.value);
      }
    },
  };
}

const guap = createGuapocadoClient({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  customerId: "org_123",
  adapter: createSqlGuapAdapter(query),
});
```

## Client types

### `createGuapocadoClient(options)`

Full client for server-side use. Requires a server key (`sk_guap_*`).

Options:

- `apiKey`: required Guapocado API key.
- `customerId`: optional default customer scope.
- `adapter`: optional `GuapAdapter` for local read-model mode.

### `createReadOnlyGuapocadoClient(options)`

Read-only client safe for client-side use. Works with client keys (`ck_guap_*`). Only exposes `has()`, `limit()`, and `usage.balance()`.

```typescript
import { createReadOnlyGuapocadoClient } from "@guapocado/sdk";

const guap = createReadOnlyGuapocadoClient({
  apiKey: "ck_guap_test_...",
  customerId: "org_123",
});
```

## Plans, subscriptions, checkout, and webhooks

```typescript
const products = await guap.plans.list();
const currentSubscription = await guap.subscription.current();
const changedSubscription = await guap.subscription.change("pro");
const purchases = await guap.purchases.list();

const checkout = await guap.checkout.create({
  productKey: "pro",
  successUrl: "https://app.example.com/billing/success",
  cancelUrl: "https://app.example.com/billing",
});

const creditPackCheckout = await guap.checkout.create({
  productKey: "api-credit-pack",
  successUrl: "https://app.example.com/billing/success",
  cancelUrl: "https://app.example.com/billing",
});

await guap.webhooks.register({
  url: "https://app.example.com/api/guap-webhook",
  events: "*",
  integration: "custom",
  registrationKey: "custom:primary",
});
```

Webhook receivers are created pending approval in the Guapocado dashboard.

## Enterprise deals (per-customer custom pricing)

Enterprise deals are per-customer overrides — a custom price and/or custom
entitlement values using the **same entitlement keys** as your catalog. They are
runtime data (not part of `billing.config`, which is shared and version-controlled).

```typescript
// Give a customer a custom deal: $2,000/mo with negotiated limits.
await guap.contracts.set(
  {
    priceAmount: 200000, // cents
    priceInterval: "month",
    entitlements: {
      "team.seats": { included: 500 },
      "api-calls": { included: 50_000_000 },
      "advanced-analytics": true,
    },
    committedVolume: 50_000_000,
    notes: "Annual enterprise agreement",
  },
  { customerId: "team_123" },
);

const deal = await guap.contracts.get({ customerId: "team_123" });
await guap.contracts.delete({ customerId: "team_123" }); // reverts to catalog plan
```

Setting a deal applies the negotiated entitlement values immediately; checkout
then bills that customer at their custom price.

## Audit log

Every mutating action is recorded with the token that performed it.

```typescript
const { logs, nextCursor } = await guap.audit.list({
  action: "usage.consume",
  resourceType: "meter",
  limit: 50,
});
```

## Plans, subscriptions, checkout, and webhooks (cont.)

Products can be recurring or one-time:

```typescript
{
  key: "pro",
  pricing: {
    mode: "recurring",
    type: "flat",
    amount: 4900,
    currency: "usd",
    frequency: "month",
  },
  entitlements: {
    "advanced-analytics": true,
    "api-calls": { included: 100000 },
    seats: { included: 10 },
  },
}

{
  key: "api-credit-pack",
  pricing: {
    mode: "one_time",
    type: "flat",
    amount: 1900,
    currency: "usd",
  },
  entitlements: {
    "api-calls": { included: 100000 },
  },
}
```

`pricing.type` is the price shape. Use `pricing.mode` to choose subscription vs
one-time checkout. Legacy `pricing.interval` is accepted as a temporary alias
for recurring `frequency`.

Guapocado webhooks deliver domain snapshot events after Stripe projection:
`customer.updated`, `subscription.updated`, `purchase.completed`,
`purchase.updated`, `entitlements.updated`, `invoice.updated`, and
`usage.updated`. `events: "*"` subscribes to all supported domain events.
Stripe event IDs remain internal source metadata, and duplicate or older Stripe
events are ignored during projection.

## Better Auth integration

Better Auth support lives in `@guapocado/better-auth` so the base SDK stays
small and framework-agnostic. The plugin can derive `customerId` from the current
user, active organization, active team, or a custom resolver.

```typescript
import { guapocado } from "@guapocado/better-auth";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  plugins: [
    guapocado({
      apiKey: process.env.GUAPOCADO_API_KEY!,
      customerId: "organization",
    }),
  ],
});
```

By default, Better Auth maps the selected user, organization, or team ID to
`customerId`. Override `mapCustomerId` if you store dedicated Guapocado customer
IDs.

## React integration

```typescript
import { GuapocadoProvider, useEntitlement, useGuapocado } from "@guapocado/react";

function App() {
  return (
    <GuapocadoProvider apiKey="ck_guap_test_..." customerId="org_123">
      <FeatureGate />
    </GuapocadoProvider>
  );
}

function FeatureGate() {
  const guap = useGuapocado();
  const { has, loading } = useEntitlement("advanced-analytics");

  async function refreshAccess() {
    await guap.has("advanced-analytics");
  }

  if (loading) return <Spinner />;
  if (!has) return <UpgradePrompt />;
  return <AnalyticsDashboard onRefresh={refreshAccess} />;
}
```

## Error handling

The SDK throws typed errors:

```typescript
import {
  GuapocadoError,
  GuapocadoAuthError,
  GuapocadoRateLimitError,
  GuapocadoValidationError,
} from "@guapocado/sdk";

try {
  await guap.has("feature");
} catch (err) {
  if (err instanceof GuapocadoAuthError) {
    // Invalid or revoked API key (401)
  } else if (err instanceof GuapocadoRateLimitError) {
    // Rate limit exceeded (429)
    console.log(err.retryAfter); // seconds until reset
  } else if (err instanceof GuapocadoValidationError) {
    // Invalid input (400)
  } else if (err instanceof GuapocadoError) {
    // Other API error
    console.log(err.status, err.requestId);
  }
}
```

## Test vs Live

API keys encode the environment mode. Use `sk_guap_test_*` keys during development and `sk_guap_live_*` in production. Test and live environments are fully isolated.

## JSON Schema for IDE support

Guapocado publishes a JSON Schema for billing config files at `https://api.guapocado.dev/v1/schema/billing`. Add it to your editor for autocomplete and validation:

### VS Code

Add to `.vscode/settings.json`:

```json
{
  "json.schemas": [
    {
      "url": "https://api.guapocado.dev/v1/schema/billing",
      "fileMatch": ["guapocado.billing.json", "billing.config.json"]
    }
  ]
}
```

### JetBrains (IntelliJ, WebStorm)

Go to **Settings > Languages & Frameworks > Schemas and DTDs > JSON Schema Mappings**, add a mapping with URL `https://api.guapocado.dev/v1/schema/billing` and file pattern `guapocado.billing.json`.

### In-file

Add `"$schema": "https://api.guapocado.dev/v1/schema/billing"` to your `guapocado.billing.json` for automatic detection.
