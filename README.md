# Guapocado packages

The public, auditable source for the Guapocado client packages. This monorepo is the
**source of truth** for everything published under the `@guapocado/*` npm scope, and every
release is published from here with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
— so each version on npm is cryptographically linked back to the exact commit and CI run in
this repository.

## Packages

| Package | Description |
| --- | --- |
| [`@guapocado/sdk`](./packages/sdk) | Server SDK — entitlements, usage, checkout, contracts, audit, plus a store-backed local read model (`createGuapLocal`) with webhook hooks. |
| [`@guapocado/shared`](./packages/shared) | Canonical billing schema + config tooling. |
| [`@guapocado/react`](./packages/react) | React hooks + UI primitives. |
| [`@guapocado/better-auth`](./packages/better-auth) | Better Auth plugin (server + client). |
| [`@guapocado/hono`](./packages/hono) | Hono middleware. |
| [`@guapocado/supabase`](./packages/supabase) | Supabase Edge Function handler. |
| [`@guapocado/cli`](./packages/cli) | The `guap` CLI. |

Runnable integration examples live in [`examples/`](./examples).

## Local read model + webhook hooks

`@guapocado/sdk` ships a batteries-included, store-backed local read model for
apps that want hot-path reads (`has`, `limit`, `usage.balance`, …) to skip the
network round trip, plus typed webhook hooks so you can react to billing
events without polling:

```typescript
import { createGuapocadoClientWithLocal } from "@guapocado/sdk";

const guap = createGuapocadoClientWithLocal({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  webhook: { publicUrl: "https://app.example.com/webhooks/guap" },
});

// The dream one-liner: mount the handler with hooks, no DB polling required.
export default {
  fetch: (request: Request) =>
    guap.handler({
      onPurchase: (ctx) => sendReceipt(ctx.customerId, ctx.purchase.productKey),
      onCancel: (ctx) => notifyChurn(ctx.customerId),
    })(request),
};
```

`createGuapLocal` (the lower-level building block behind
`createGuapocadoClientWithLocal`) works over any `GuapStore` — an in-memory
default for dev, or your own SQL/KV-backed implementation for production. See
[`@guapocado/sdk`](./packages/sdk#store-backed-local-read-model-createguaplocal)
for the full `GuapStore` contract, the two-tier hook delivery contract, and
staleness/idempotency guidance, and
[`@guapocado/hono`](./packages/hono#mounting-with-guaplocalhandler) for the
one-line Hono mount (`guapLocalHandler`).

## Verifying provenance

```bash
npm view @guapocado/sdk@latest --json   # look for the dist.attestations block
```
On npmjs.com each package page shows a **Provenance** panel linking to the building commit.

## Develop

```bash
pnpm install
pnpm build      # turbo, in dependency order
pnpm test
pnpm lint       # biome + exported-JSDoc coverage
```

## License

[MIT](./LICENSE)
