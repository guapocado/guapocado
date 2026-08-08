# Operations and safety

Read this reference before using the CLI, credentials, webhooks, or generated local tables.

## Use the CLI deliberately

Typical local setup:

```bash
npm install @guapocado/sdk
npm install --save-dev @guapocado/cli
npx guap init
```

Inspect before mutating remote state:

```bash
npx guap whoami
npx guap plan --test
```

Run authentication, agent signup, or push only with explicit authorization:

```bash
npx guap login --test
npx guap signup --agent --agent-name codex --name "Product billing" --json
npx guap push --test
```

Agent signup creates a disposable provisional test workspace and stores a restricted bootstrap
credential. Give the returned claim URL to the user without exposing stored keys. Claiming creates
a separately identified permanent organization, adopts the existing test configuration, and
discards the provisional tenant. Do not imply that an unclaimed workspace has a production
environment ready for use.

Use `--live` only when explicitly requested after reviewing a live plan. Do not translate a request
to "set up billing" into an unreviewed production push.

## Handle credentials

- Ignore `.guapocado/` before login or signup.
- Use `guap whoami` for masked identity and environment information.
- Keep `sk_guap_test_...` and `sk_guap_live_...` keys on the server.
- Use `ck_guap_test_...` and `ck_guap_live_...` only for supported client reads.
- Put names and placeholders—not values—in `.env.example` or deployment documentation.
- Never print credential files or include them in diffs, logs, fixtures, screenshots, or answers.

## Respect version contracts

The SDK sends its compatible API contract automatically. Determine the installed version from the
package manifest or exported constants. For raw HTTP, set the contract version intentionally.

When upgrading:

1. Read the current API-versioning and changelog docs.
2. Upgrade related packages coherently.
3. Exercise the integration in test.
4. Upgrade the test environment first.
5. Move live only after validation and explicit approval.

Do not bake a "latest" version number into generated code based only on this skill.

## Configure webhooks and local reads

Consume Guapocado domain events rather than reimplementing raw Stripe webhook projection. Follow
the installed SDK/framework contract for registration, signature verification, event
idempotency, and hooks.

For local read-model mode:

```bash
npx guap generate --tables --orm drizzle --db <sqlite|pg|mysql>
```

Review generated files, integrate them into the application's migration workflow, and verify the
public webhook route. Do not manually invent projection tables when the installed CLI can generate
the compatible schema and adapter.

Use the local relay only for development and only after confirming the configured receiver. Set
`webhooks.devTunnel: true` in `billing.config.ts` before starting it:

```bash
npx guap listen --test --dev
```

## Troubleshoot from evidence

- Authentication failure: run masked `guap whoami`; verify key type and test/live selection.
- Type or API mismatch: compare installed package versions, exported types, and the requested API
  contract.
- Wrong customer's access: trace the trusted session-to-`customerId` mapping across every call.
- Duplicate usage: inspect idempotency keys and retry boundaries.
- Missing access after payment: inspect Guapocado domain-event delivery and projection state.
- Local read miss: verify adapter configuration, event delivery, migration state, and staleness
  policy before bypassing the local model.
- Checkout redirect rejection: compare return hosts with `checkout.allowedRedirectHosts`.

Show sanitized errors and the checks performed. Never diagnose by dumping secrets.
