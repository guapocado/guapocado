# @guapocado/better-auth

Better Auth plugin for Guapocado billing. It keeps `@guapocado/sdk` as a small
framework-agnostic primitives package and layers Better Auth-specific session mapping here.

```bash
npm install @guapocado/better-auth
```

```typescript
import { guapocado } from "@guapocado/better-auth";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [
    organization({
      teams: {
        enabled: true,
      },
    }),
    guapocado({
      apiKey: process.env.GUAPOCADO_API_KEY!,
      customerId: "organization", // "user" | "organization" | "team"
      webhook: {
        path: "/guap",
      },
    }),
  ],
});
```

The plugin adds authenticated Guapocado endpoints to `auth.api`:

```typescript
export async function GET(request: Request) {
  const result = await auth.api.guapocadoHas({
    headers: request.headers,
    body: { key: "advanced-analytics" },
  });

  return Response.json(result);
}
```

For browser code, install the Guapocado client plugin into Better Auth's client:

```typescript
import { guapocadoClient } from "@guapocado/better-auth/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [guapocadoClient()],
});

const usage = await authClient.guapocado.usage.consume("api-calls", 1);
const checkout = await authClient.guapocado.checkout.create({
  productKey: "pro",
  successUrl: `${location.origin}/billing/success`,
  cancelUrl: `${location.origin}/billing`,
});
```

The client plugin exposes typed customer, context, entitlement, limit, usage,
plans, subscription, and checkout actions under `authClient.guapocado`.
Checkout uses `productKey` for both recurring and one-time products. `planKey`
is still accepted as a deprecated alias for recurring products.

Use `customer.sync()` when the current Better Auth session should create or update
the corresponding Guapocado customer:

```typescript
const customer = await authClient.guapocado.customer.sync();
```

Usage endpoints follow the same naming:

```typescript
await auth.api.guapocadoUsageBalance({
  headers: request.headers,
  body: { key: "api-calls" },
});

await auth.api.guapocadoUsageConsume({
  headers: request.headers,
  body: { key: "api-calls", amount: 1 },
});

await auth.api.guapocadoUsageRefund({
  headers: request.headers,
  body: { key: "api-calls", amount: 1 },
});
```

By default, the plugin maps the selected user, organization, or team ID to
`customerId`. Override `mapCustomerId` if you store dedicated Guapocado customer
IDs.

`customerId: "organization"` requires Better Auth's `organization()` plugin.
`customerId: "team"` requires `organization({ teams: { enabled: true } })`.
`customerId: "user"` works with Better Auth core sessions only.

## Webhook receiver

The server plugin adds `GET/POST /api/auth/guap` by default. `GET` resolves the
public URL from the request and registers it with Guapocado using the server API
key. The endpoint is created disabled in the Guapocado dashboard, so it must be
approved before events are forwarded.

Declare the forwarding intent in `billing.config.ts`:

```typescript
export default defineBilling({
  // entitlements and products...
  webhooks: {
    devTunnel: true,
    forwarding: [
      {
        key: "better-auth",
        path: "/api/auth/guap",
        events: "*",
        integration: "better-auth",
        autoRegister: true,
      },
    ],
  },
});
```

`events: "*"` subscribes to all Guapocado domain snapshot events:
`customer.updated`, `subscription.updated`, `purchase.completed`,
`purchase.updated`, `entitlements.updated`, `invoice.updated`, and
`usage.updated`. These are emitted after Stripe has been projected into
Guapocado state. Raw Stripe event IDs are kept as internal source metadata, so
receivers can store verified Guapocado events without replaying Stripe logic.

With `devTunnel: true`, `guap listen --test --dev` can start the dev-only
relay and forward approved test events to your local receiver.

Then enable the receiver in the Better Auth plugin. No webhook signing secret is
required in user config; the plugin registers the receiver with Guapocado and
stores the returned signing secret in its plugin table.

```typescript
guapocado({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  customerId: "user",
  webhook: {
    path: "/guap",
    events: "*",
    autoRegister: true,
  },
});
```

Use `webhook.publicUrl` if your app sits behind a proxy and the request URL is
not the externally reachable URL.

For custom identity models, resolve the `customerId` yourself:

```typescript
guapocado({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  resolveCustomerId: async (session) => String(session.session?.workspaceId),
});
```
