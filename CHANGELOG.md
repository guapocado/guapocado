# Changelog

All notable changes to the `@guapocado/*` packages. Pre-1.0 — while on `0.0.x`, **any
release may contain breaking changes**. Pin exact versions.

## 0.0.6

All seven packages release in lockstep this version.

### Added

- **`@guapocado/sdk`** — a batteries-included, store-backed local read model:
  `createGuapLocal({ apiKey, store?, webhook?, hooks? })` returns a concrete
  `GuapAdapter` (`adapter`), a fetch-shaped webhook receiver (`handler`), a
  projection test seam (`project`), and an explicit `register`. Verifies the
  `guapocado-signature` header, dedupes deliveries by event id, and projects
  `customer.updated` / `subscription.updated` / `purchase.completed` /
  `purchase.updated` / `entitlements.updated` / `invoice.updated` into a
  minimal `GuapStore` (`get`/`put`/`delete`/`listByPrefix`) using
  last-write-wins ordering on the event's `createdAt`. `createMemoryGuapStore()`
  ships an in-memory implementation; `testGuapStoreContract` (exported from
  `@guapocado/sdk/testing`) validates a custom SQL/KV-backed one against the
  same contract suite. `createGuapocadoClientWithLocal` is the one-liner that
  wires the adapter in and attaches `.handler` to the returned client.
  New webhook endpoints register `pending_approval` until approved in the
  dashboard — reads stay correct via API miss-through in the meantime.
- **`@guapocado/sdk`** — webhook hooks: `guap.handler({ ... })` runs your
  functions after an event is verified and projected, no DB polling required.
  Catch-all `onEvent`; raw per-event hooks (`onCustomerUpdated`,
  `onSubscriptionUpdated`, `onPurchaseCompleted`, `onPurchaseUpdated`,
  `onEntitlementsUpdated`, `onInvoiceUpdated`); and semantic transition hooks
  derived from the previously stored record (`onSubscribe`, `onCancel`,
  `onPlanChange`, `onPurchase`). Hooks run after projection but before the
  delivery is marked handled, so a throwing hook causes a `500` and an
  at-least-once retry re-fires it — hooks must be idempotent. Both
  pre-packaged function references and inline lambdas are fully typed with
  zero annotations.
- **`@guapocado/sdk`** — `verifyGuapocadoSignature`, extracted from
  `@guapocado/better-auth`'s internal HMAC check (Web Crypto only, no new
  runtime dependency) so any receiver can verify a Guapocado webhook
  signature the same way the platform's Better Auth plugin does.
- **`@guapocado/hono`** — `guapLocalHandler(local, hooks?)` adapts a
  `GuapLocal`'s `handler` into a one-line Hono route mount:
  `app.all("/webhooks/guap", guapLocalHandler(local, { onCancel, onPurchase }))`.

### Changed

- **`@guapocado/better-auth`** — no functional changes; added a code comment
  noting its internal HMAC verification now duplicates
  `@guapocado/sdk`'s `verifyGuapocadoSignature` and should delegate to it in
  a future change.

## 0.0.4

`@guapocado/cli` only — the other packages are unchanged and remain at `0.0.3`.

### Added

- **`@guapocado/cli`** — `guap whoami` prints the active workspace and the credentials in use
  (keys masked), reading `.guapocado/credentials.json` and falling back to `GUAPOCADO_API_KEY`
  in `.env`.
- **`@guapocado/cli`** — `guap login`, `push`, and `pull` now warn when `.guapocado/` (which
  holds your API keys) isn't git-ignored, with a one-line fix to add it to `.gitignore`.

## 0.0.3

First release published from this public source-of-truth repository, with **npm provenance**
(each version is cryptographically linked to its building commit + CI run). Supersedes the
unprovenanced `0.0.1` on npm; bundles everything below.

### Breaking

- **`@guapocado/better-auth`** — peer dependency tightened from `better-auth >=1.0.0` to
  `^1.6.11` (built/tested against `1.6.x`; older cores produced type-inference and runtime
  mismatches).
- **`@guapocado/better-auth`** — the plugin no longer declares its own `id` column on the
  webhook tables (Better Auth adds the primary key). Re-run `better-auth generate` if you
  generated schema from `0.0.1` — the old output created a duplicate-`id` table.
- **`@guapocado/cli`** — `guap login` no longer takes `--sandbox` / `--production`. One login
  authorizes a workspace and mints both keys; use `guap workspace list` / `guap workspace
  select` to switch.
- **Checkout** — a `mode: "custom"` ("contact us") tier returns `409` from checkout unless the
  customer has an enterprise contract supplying an inline price.

### Added

- **`@guapocado/shared`** — `mode: "custom"` ("contact us") pricing: no Stripe price, optional
  `type`, optional `contact` link; surfaced in the canonical JSON schema and validated.
- **`@guapocado/cli`** — `--config <path>` (alias `-c`) on `push`, `plan`, `generate`, `listen`
  (a config file or a directory containing one). Plus `guap workspace list` / `select`.
- **`@guapocado/better-auth`** — exported all client result types (`AuthClientResult`,
  `GuapocadoCheckout`, `GuapocadoContext`, …) so consumers import them instead of casting.

### Changed

- **`@guapocado/better-auth`** — `authClient.guapocado.*` returns Better Auth's `{ data, error }`
  envelope (the standalone `@guapocado/sdk` server client still returns values directly and
  throws `GuapocadoError`).
