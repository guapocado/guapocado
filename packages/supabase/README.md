# @guapocado/supabase

Thin Supabase Edge Function handler for Guapocado.

Supabase Edge Functions run on Deno and use `Deno.serve(handler)`.

```ts
import { handler } from "npm:@guapocado/supabase";

Deno.serve(handler);
```

Set the server key as a Supabase secret:

```bash
supabase secrets set GUAPOCADO_API_KEY=guap_sk_...
```

The default handler exposes a small JSON API:

- `GET /health`
- `GET /features/:key?customerId=...`
- `GET /limits/:key?customerId=...`
- `GET /usage/:key?customerId=...`
- `POST /usage/:key/consume`
- `POST /context`
- `POST /checkout`
- `GET /plans`
- `GET /subscription?customerId=...`
- `POST /subscription/change`
- `POST /customers`

For browser-callable functions, resolve `customerId` from Supabase Auth instead
of trusting a query string:

```ts
import { createGuapocadoSupabaseHandler } from "npm:@guapocado/supabase";
import { createClient } from "npm:@supabase/supabase-js@2";

const handler = createGuapocadoSupabaseHandler({
  allowRequestCustomerId: false,
  customerId: async (request) => {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return undefined;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authorization } } },
    );

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return undefined;
    return data.user.id;
  },
});

Deno.serve(handler);
```

Webhook registration is disabled by default. Enable it explicitly:

```ts
const handler = createGuapocadoSupabaseHandler({
  webhooks: {
    enabled: true,
    registrationKey: Deno.env.get("GUAPOCADO_WEBHOOK_REGISTRATION_KEY"),
  },
});
```

Some non-Supabase routers use method exports. The package includes an `ALL`
alias for those adapters:

```ts
import { handler } from "@guapocado/supabase";

export const ALL = handler;
```
