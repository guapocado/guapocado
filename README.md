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
