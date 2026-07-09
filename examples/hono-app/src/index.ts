import {
	type GuapocadoHonoEnv,
	getGuap,
	getGuapCustomerId,
	guapLocalHandler,
} from "@guapocado/hono";
import {
	type GuapCancelHookContext,
	type GuapLocal,
	createGuapLocal,
	createGuapocadoClient,
} from "@guapocado/sdk";
import { Hono } from "hono";

type Bindings = {
	GUAPOCADO_API_KEY: string;
	// Publicly reachable base URL for this Worker (e.g.
	// "https://guapocado-example.<subdomain>.workers.dev"), used to register
	// the webhook endpoint. Required for auto-registration — the SDK never
	// derives the registration URL from request data by default.
	GUAPOCADO_PUBLIC_URL: string;
};

type AppEnv = GuapocadoHonoEnv<{ Bindings: Bindings }>;

const app = new Hono<AppEnv>();

// Lazily create one store-backed local read model per Worker isolate, keyed
// off the first request's API key (there is only ever one key per deployed
// Worker). `webhook.publicUrl` is required for auto-registration to run at
// all — set GUAPOCADO_PUBLIC_URL to this Worker's public URL.
let local: GuapLocal | undefined;
function getLocal(apiKey: string, publicUrl: string): GuapLocal {
	local ??= createGuapLocal({ apiKey, webhook: { publicUrl: `${publicUrl}/webhooks/guap` } });
	return local;
}

app.use("*", async (c, next) => {
	const apiKey = c.env.GUAPOCADO_API_KEY;
	const customerId = c.req.query("customerId");
	// Wire the same local read model in as the client's adapter, so entitlement
	// reads become local-first once webhook events start flowing.
	c.set(
		"guap",
		createGuapocadoClient({
			apiKey,
			customerId,
			adapter: getLocal(apiKey, c.env.GUAPOCADO_PUBLIC_URL).adapter,
		}),
	);
	if (customerId) c.set("guapCustomerId", customerId);
	await next();
});

async function sendCancellationEmail(ctx: GuapCancelHookContext): Promise<void> {
	console.log(`customer ${ctx.customerId} canceled (was on ${ctx.previous?.planKey ?? "unknown"})`);
}

// The one-liner: verifies the signature, dedupes, projects the event into the
// local store, and runs hooks — no DB polling required. Both a pre-packaged
// function reference (onCancel) and an inline lambda (onPurchase) fully
// type-check with zero annotations.
app.all("/webhooks/guap", (c) =>
	guapLocalHandler(getLocal(c.env.GUAPOCADO_API_KEY, c.env.GUAPOCADO_PUBLIC_URL), {
		onCancel: sendCancellationEmail,
		onPurchase: async (ctx) => {
			console.log(`customer ${ctx.customerId} purchased ${ctx.purchase.productKey}`, ctx.grants);
		},
	})(c),
);

app.get("/", (c) => c.json({ app: "guapocado-example", status: "ok" }));

app.get("/features/:feature", async (c) => {
	const feature = c.req.param("feature");
	const customerId = getGuapCustomerId(c);
	if (!customerId) return c.json({ error: "customerId required" }, 400);
	const has = await getGuap(c).has(feature);
	return c.json({ feature, hasAccess: has });
});

app.get("/quota/:meter", async (c) => {
	const meter = c.req.param("meter");
	const customerId = getGuapCustomerId(c);
	if (!customerId) return c.json({ error: "customerId required" }, 400);
	const usage = await getGuap(c).usage.balance(meter);
	return c.json({ meter, ...usage });
});

app.post("/use/:meter", async (c) => {
	const meter = c.req.param("meter");
	const body = await c.req.json<{ amount?: number; customerId?: string }>();
	const customerId = body.customerId ?? getGuapCustomerId(c);
	if (!customerId) return c.json({ error: "customerId required" }, 400);
	const usage = await getGuap(c).usage.consume(meter, body.amount ?? 1, { customerId });
	return c.json(usage);
});

app.get("/limits/:limit", async (c) => {
	const limit = c.req.param("limit");
	const customerId = getGuapCustomerId(c);
	if (!customerId) return c.json({ error: "customerId required" }, 400);
	const result = await getGuap(c).limit(limit);
	return c.json({ key: limit, ...result });
});

export default app;
