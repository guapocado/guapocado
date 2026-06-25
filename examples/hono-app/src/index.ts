import { type GuapocadoHonoEnv, getGuap, getGuapCustomerId, guapocado } from "@guapocado/hono";
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
