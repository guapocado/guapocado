# @guapocado/react

React primitives for Guapocado. This package depends on `@guapocado/sdk`
and has React as a peer dependency, keeping the base SDK free of framework code.

```bash
npm install @guapocado/react
```

```tsx
import { GuapocadoProvider, useEntitlement, useGuapocado, withGuapocado } from "@guapocado/react";

export function App() {
  return (
    <GuapocadoProvider apiKey="ck_guap_test_..." customerId="org_123">
      <FeatureGate />
      <ReportsButton />
    </GuapocadoProvider>
  );
}

function FeatureGate() {
  const guap = useGuapocado();

  async function openFeature() {
    if (await guap.has("advanced-analytics")) {
      // show feature
    }
  }

  return <button onClick={openFeature}>Open analytics</button>;
}

function Reports({ guap }) {
  const { has, loading } = useEntitlement("advanced-analytics");
  if (loading) return null;
  return has ? <AnalyticsDashboard /> : <UpgradePrompt />;
}

const ReportsButton = withGuapocado(Reports);
```

`customerId` is whatever stable entity your product bills: a user ID, organization
ID, team ID, workspace ID, project ID, or your own dedicated Guapocado customer ID.

## UI entrypoints

The root import stays focused on the billing client provider, hooks, SDK types,
and helpers. UI components live behind subpath exports so apps that do not import
them do not pull in UI dependencies.

```tsx
import { GuapocadoProvider } from "@guapocado/react";
import { GuapocadoUIProvider } from "@guapocado/react/ui";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@guapocado/react/ui/primitives";

export function GuapocadoShell() {
  return (
    <GuapocadoUIProvider
      locale="en-AU"
      currency="AUD"
      labels={{ upgrade: "Change plan" }}
      plan={{ id: "pro", name: "Pro", price: 49, interval: "month" }}
    >
      <GuapocadoProvider apiKey="ck_guap_test_..." customerId="org_123">
        <Card>
          <CardHeader>
            <CardTitle>Pro</CardTitle>
            <Badge>Current plan</Badge>
          </CardHeader>
          <CardContent>
            <Button type="button">Manage plan</Button>
          </CardContent>
        </Card>
      </GuapocadoProvider>
    </GuapocadoUIProvider>
  );
}
```

`GuapocadoUIProvider` only owns UI-level defaults: formatter defaults, labels,
and optional plan/subscription display context. It does not create or replace the
Guapocado client context; keep using `GuapocadoProvider` for SDK access.

## Tailwind setup

The UI primitives are Tailwind-only and do not ship fallback CSS. Components use
shadcn-compatible utility classes and CSS variable tokens such as `bg-background`,
`text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`,
`bg-card`, `text-card-foreground`, `bg-muted`, `bg-accent`, and `ring-ring`.

Configure Tailwind to scan the package UI output.

Tailwind v4:

```css
@import "tailwindcss";
@source "../node_modules/@guapocado/react";
```

Tailwind v3:

```js
export default {
  content: [
    "./src/**/*.{ts,tsx}",
    "./node_modules/@guapocado/react/dist/**/*.{js,mjs}",
  ],
};
```

The package does not attempt automatic Tailwind detection because that is not
reliable across Vite, Astro, Next, Remix, tsup output, and custom CSS pipelines.
