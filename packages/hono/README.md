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
