# Changelog

All notable changes to the `@guapocado/*` packages. Pre-1.0 — while on `0.0.x`, **any
release may contain breaking changes**. Pin exact versions.

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
