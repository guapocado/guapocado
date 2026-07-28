# Billing modeling

Read this reference before creating or materially changing a Guapocado billing model.

## Choose one stable customer identity

Map `customerId` to the entity that buys and owns access:

| Product shape | Typical identity |
| --- | --- |
| Consumer product | User |
| B2B SaaS | Organization, workspace, or account |
| Team-scoped product | Team |
| Project billing | Project |

Derive the value from trusted auth or server-side membership state. Do not accept an arbitrary
browser-provided `customerId` for privileged reads or writes. Keep the same ID across customer sync,
checkout, subscriptions, purchases, entitlements, and usage.

## Choose the correct entitlement primitive

| Primitive | Meaning | Enforcement |
| --- | --- | --- |
| `feature` | Boolean permission such as SSO or exports | Check `guap.has(key)` |
| `meter` | Usage that Guapocado records, decrements, and optionally resets | Read balance and call `usage.consume` |
| `limit` | Numeric allowance compared with application-owned state | Read `guap.limit(key)` and compare locally |

Do not use a meter when the application already owns the current count. Seats, projects, and team
members are normally limits. API calls, credits, and generated minutes are normally meters.

## Model products and pricing

- Omit pricing for free or internal products.
- Use `pricing.mode: "recurring"` for monthly or yearly subscriptions.
- Use `pricing.mode: "one_time"` for credit packs, lifetime unlocks, purchased limit expansion, or
  one-off fees.
- Use `pricing.mode: "custom"` for negotiated/contact-sales products.
- Express `amount` in the currency's smallest unit.
- Use config product keys in application code. Let Guapocado own Stripe product and price mapping.
- Use `checkout.allowedRedirectHosts` when the application has known checkout return hosts.

Retrieve the current schema from `https://api.guapocado.dev/v1/schema/billing` before writing
advanced config. Prefer `defineBilling` from the installed SDK so TypeScript checks the config.

## Account for usage safely

- Consume usage at the point the action becomes billable.
- Supply an idempotency key for retryable requests, jobs, queue deliveries, or workflows.
- If usage must be reserved before fallible work, refund it when the downstream work fails.
- Do not swallow a failed consumption and continue performing billable work unless the product
  explicitly allows overage.
- Keep keys stable across config, runtime calls, analytics, and user-facing plan descriptions.

## Design an enforceable slice

For each billed capability, identify:

1. The config definition.
2. The product grant.
3. The trusted `customerId`.
4. The server enforcement point.
5. The upgrade or checkout path.
6. The test that proves allowed and denied behavior.

Avoid adding display-only billing UI without enforcing the same rule on the server.
