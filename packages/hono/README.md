# @guapocado/hono

Thin Hono helpers for the Guapocado server SDK.

```typescript
import { getGuap, getGuapCustomerId, guapocado, type GuapocadoHonoEnv } from "@guapocado/hono";
import { Hono } from "hono";

type Bindings = {
  GUAPOCADO_API_KEY: string;
};

type AppEnv = GuapocadoHonoEnv<{ Bindings: Bindings }>;

const app = new Hono<AppEnv>();

app.use(
  "*",
  guapocado<{ Bindings: Bindings }>({
    apiKey: (c) => c.env.GUAPOCADO_API_KEY,
    customerId: (c) => c.req.query("customerId"),
  }),
);

app.get("/features/:feature", async (c) => {
  const customerId = getGuapCustomerId(c);
  if (!customerId) return c.json({ error: "customerId required" }, 400);

  const has = await getGuap(c).has(c.req.param("feature"));
  return c.json({ hasAccess: has });
});

export default app;
```

The middleware creates a normal `@guapocado/sdk` client and stores it on Hono
context variables:

- `guap`: the server SDK client.
- `guapCustomerId`: optional customer scope resolved for this request.

It does not own auth, routing, sessions, or webhook projection.

## Mounting with `guapLocalHandler`

If you're using `@guapocado/sdk`'s store-backed local read model
(`createGuapLocal`), `guapLocalHandler` adapts its fetch-shaped webhook
`handler` into a Hono route in one line — the dream line, in Hono form:

```typescript
import { createGuapLocal, createGuapocadoClient } from "@guapocado/sdk";
import { guapLocalHandler } from "@guapocado/hono";
import { Hono } from "hono";

const local = createGuapLocal({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  webhook: { publicUrl: "https://app.example.com/webhooks/guap" },
});

// Wire the local read model in as the client's adapter for local-first reads.
const guap = createGuapocadoClient({
  apiKey: process.env.GUAPOCADO_API_KEY!,
  adapter: local.adapter,
});

const app = new Hono();

app.all(
  "/webhooks/guap",
  guapLocalHandler(local, {
    onPurchase: async (ctx) => {
      await sendReceipt(ctx.customerId, ctx.purchase.productKey);
    },
    onCancel: async (ctx) => {
      await notifyChurn(ctx.customerId, ctx.previous);
    },
  }),
);

app.get("/features/:key", async (c) => {
  const hasAccess = await guap.has(c.req.param("key"), { customerId: c.req.query("customerId") });
  return c.json({ hasAccess });
});

export default app;
```

`guapLocalHandler` takes the `GuapLocal` returned by `createGuapLocal` — not
the `.handler`-augmented client from `createGuapocadoClientWithLocal`, which
only exposes `.handler` and doesn't structurally satisfy `GuapLocal` (it's
missing `adapter`/`project`/`register`). It forwards `hooks` unchanged to
`local.handler(hooks)` — omit them to fall back to projection-only behavior.
`app.get(...)`/`app.post(...)` also work in place of `app.all(...)`; the
underlying handler branches on `GET` (registration status/bootstrap) vs `POST`
(event delivery) itself. See
[`@guapocado/sdk`](../sdk#store-backed-local-read-model-createguaplocal) for
the full local read model docs — the `GuapStore` contract, `webhook.publicUrl`
requirement, staleness (`maxAgeMs`), and the two-tier hook contract.
