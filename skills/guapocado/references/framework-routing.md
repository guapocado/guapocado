# Framework and deployment routing

Read this reference before choosing packages or deployment mode.

## Package selection

| Application need | Package or approach |
| --- | --- |
| Server, Node.js, edge runtime, or custom framework | `@guapocado/sdk` |
| React provider, hooks, or UI primitives | `@guapocado/react` |
| Better Auth session and client integration | `@guapocado/better-auth` |
| Hono request middleware | `@guapocado/hono` |
| Supabase Edge Function | `@guapocado/supabase` |
| Config init, plan, push, pull, generation, and local webhook relay | `@guapocado/cli` / `guap` |
| Other language or raw HTTP | Versioned HTTP API |

Install only the layers the application uses. Keep the SDK available on trusted server paths even
when adding a client or framework adapter.

## Server and browser boundary

- Use a server key only in backend code.
- Use a client key only for supported browser-safe reads.
- Put checkout, usage mutations, customer sync, subscription changes, and limit settings behind
  authenticated server paths.
- Resolve customer identity from the session, active organization, or verified membership instead
  of request query parameters or untrusted form fields.

For React, keep `GuapocadoProvider` responsible for SDK access and
`GuapocadoUIProvider` responsible only for presentation defaults. Configure Tailwind scanning only
when importing the optional UI primitives, following the installed package README.

For Better Auth, select the native `user`, `organization`, or `team` source that matches who pays.
Verify the corresponding Better Auth plugin is enabled. Use custom mapping only when the
application deliberately namespaces or stores a separate billing ID.

For Hono, use middleware when request-scoped customer resolution avoids repeated setup. The helper
does not own authentication.

For Supabase browser-callable functions, disable request-supplied customer IDs and resolve identity
from the verified Supabase user or organization membership.

## Choose a deployment mode

### Managed edge API — default

Choose managed mode when network reads are acceptable and the application does not require local
billing tables. This is the smallest and safest integration.

### Local read model — explicit optimization

Choose local mode only when at least one requirement is concrete:

- Measured entitlement-read latency on a hot path.
- Reads must continue without a Guapocado API round trip.
- SQL reporting over projected billing state.
- An existing event-projection architecture makes local storage operationally appropriate.

Local mode requires webhook delivery, idempotent projection, database migrations, and staleness
handling. Generate supported Drizzle tables for the actual database dialect and run them through
the application's normal migration workflow. Configure the adapter for local-first reads.

Keep all authoritative commands API-backed in both modes. Do not describe the local projection as
the payment source of truth.

## Preserve existing versions

For an existing integration, read the installed package exports and types before editing. Do not
copy examples from a newer docs version into older pinned packages without an explicit upgrade.
For a new integration, check npm and install mutually compatible `@guapocado/*` releases.
