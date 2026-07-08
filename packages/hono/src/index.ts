import {
	type GuapLocal,
	type GuapWebhookHooks,
	type GuapocadoClient,
	type GuapocadoClientOptions,
	createGuapocadoClient,
} from "@guapocado/sdk";
import type { Context, Env, MiddlewareHandler } from "hono";

/** Hono context variables installed by the Guapocado middleware. */
export type GuapocadoHonoVariables = {
	guap: GuapocadoClient;
	guapCustomerId?: string;
};

type ExistingVariables<E extends Env> = E extends { Variables: infer Variables }
	? Variables
	: Record<string, never>;

/** Hono Env type augmented with Guapocado context variables. */
export type GuapocadoHonoEnv<E extends Env = Env> = Omit<E, "Variables"> & {
	Variables: ExistingVariables<E> & GuapocadoHonoVariables;
};

/** Value or request-aware function used by the Hono middleware. */
export type GuapocadoHonoResolver<E extends Env, T> = T | ((c: Context<E>) => T | Promise<T>);

/** Options for the Guapocado Hono middleware. */
export type GuapocadoHonoOptions<E extends Env = Env> = Omit<
	GuapocadoClientOptions,
	"apiKey" | "customerId"
> & {
	apiKey: GuapocadoHonoResolver<E, string | null | undefined>;
	customerId?: GuapocadoHonoResolver<E, string | null | undefined>;
	onMissingApiKey?: (c: Context<E>) => Response | Promise<Response>;
};

async function resolveValue<E extends Env, T>(
	c: Context<E>,
	resolver: GuapocadoHonoResolver<E, T> | undefined,
): Promise<T | undefined> {
	if (typeof resolver === "function") {
		return (resolver as (c: Context<E>) => T | Promise<T>)(c);
	}
	return resolver;
}

function optionalString(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Creates Hono middleware that resolves a Guapocado API key (and optional
 * customer scope) per request, builds a `@guapocado/sdk` client, and stores it
 * on the context as `c.var.guap` for downstream handlers to use.
 *
 * The `apiKey` and `customerId` options accept either a static value or a
 * function of the Hono context, so secrets can be read from `c.env` and the
 * customer can be derived from the request. When no API key resolves the
 * middleware short-circuits with a 500 response, or invokes `onMissingApiKey`
 * if you provide one.
 *
 * @param options - Middleware configuration: an `apiKey` resolver, an optional
 *   `customerId` resolver, an optional `onMissingApiKey` fallback response, and
 *   any other `@guapocado/sdk` client options (such as `baseUrl`).
 * @returns A Hono `MiddlewareHandler` that populates the Guapocado context
 *   variables and then calls `next()`.
 * @example
 * ```typescript
 * import { guapocado, getGuap, type GuapocadoHonoEnv } from "@guapocado/hono";
 * import { Hono } from "hono";
 *
 * type Bindings = { GUAPOCADO_API_KEY: string };
 * const app = new Hono<GuapocadoHonoEnv<{ Bindings: Bindings }>>();
 *
 * app.use(
 *   "*",
 *   guapocado<{ Bindings: Bindings }>({
 *     apiKey: (c) => c.env.GUAPOCADO_API_KEY,
 *     customerId: (c) => c.req.query("customerId"),
 *   }),
 * );
 *
 * app.get("/features/:key", async (c) => {
 *   const hasAccess = await getGuap(c).has(c.req.param("key"));
 *   return c.json({ hasAccess });
 * });
 * ```
 */
export function guapocado<E extends Env = Env>(
	options: GuapocadoHonoOptions<E>,
): MiddlewareHandler<GuapocadoHonoEnv<E>> {
	const {
		apiKey: apiKeyResolver,
		customerId: customerIdResolver,
		onMissingApiKey,
		...clientOptions
	} = options;

	return async (c, next) => {
		const resolverContext = c as unknown as Context<E>;
		const apiKey = optionalString(await resolveValue(resolverContext, apiKeyResolver));

		if (!apiKey) {
			if (onMissingApiKey) return onMissingApiKey(resolverContext);
			return c.json({ error: "Guapocado API key is required" }, 500);
		}

		const customerId = optionalString(await resolveValue(resolverContext, customerIdResolver));
		const guap = createGuapocadoClient({
			...clientOptions,
			apiKey,
			customerId,
		});

		c.set("guap", guap);
		if (customerId) c.set("guapCustomerId", customerId);
		await next();
	};
}

/**
 * Reads the Guapocado SDK client that the {@link guapocado} middleware stored on
 * the Hono context, giving handlers a typed accessor instead of an untyped
 * `c.get("guap")` lookup.
 *
 * Must run after the `guapocado()` middleware on the same route; the client is
 * already scoped to the resolved customer (if any).
 *
 * @param c - The Hono request context whose `Variables` include the Guapocado
 *   client installed by the middleware.
 * @returns The request-scoped `@guapocado/sdk` client.
 * @example
 * ```typescript
 * import { getGuap } from "@guapocado/hono";
 *
 * app.get("/usage/:key", async (c) => {
 *   const balance = await getGuap(c).usage.balance(c.req.param("key"));
 *   return c.json(balance);
 * });
 * ```
 */
export function getGuap<E extends Env & { Variables: GuapocadoHonoVariables }>(
	c: Context<E>,
): GuapocadoClient {
	return c.get("guap");
}

/**
 * Reads the optional customer scope that the {@link guapocado} middleware
 * resolved for this request, returning `undefined` when no `customerId` was
 * configured or resolved.
 *
 * Handlers typically use this to reject unscoped requests or to log which
 * customer a billing action applied to.
 *
 * @param c - The Hono request context whose `Variables` include the Guapocado
 *   client installed by the middleware.
 * @returns The resolved customer id, or `undefined` when the request is
 *   unscoped.
 * @example
 * ```typescript
 * import { getGuap, getGuapCustomerId } from "@guapocado/hono";
 *
 * app.get("/features/:key", async (c) => {
 *   const customerId = getGuapCustomerId(c);
 *   if (!customerId) return c.json({ error: "customerId required" }, 400);
 *   return c.json({ hasAccess: await getGuap(c).has(c.req.param("key")) });
 * });
 * ```
 */
export function getGuapCustomerId<E extends Env & { Variables: GuapocadoHonoVariables }>(
	c: Context<E>,
): string | undefined {
	return c.get("guapCustomerId");
}

/**
 * Adapts a `@guapocado/sdk` local read model's fetch-shaped webhook `handler`
 * into a Hono route handler, so mounting it is a one-liner:
 * `app.all("/webhooks/guap", guapLocalHandler(local, hooks))`. Forwards
 * `hooks` to `local.handler(hooks)` unchanged — omit them to fall back to the
 * projection-only behavior of `local.handler()`.
 *
 * @param local - The `GuapLocal` returned by `createGuapLocal` (from `@guapocado/sdk`).
 * @param hooks - Optional webhook hooks to run after each verified, projected event.
 * @returns A Hono route handler you can pass directly to `app.all(path, ...)`.
 * @example
 * ```typescript
 * import { createGuapLocal } from "@guapocado/sdk";
 * import { guapLocalHandler } from "@guapocado/hono";
 * import { Hono } from "hono";
 *
 * const local = createGuapLocal({
 *   apiKey: process.env.GUAPOCADO_API_KEY!,
 *   webhook: { publicUrl: "https://app.example.com/webhooks/guap" },
 * });
 *
 * const app = new Hono();
 * app.all(
 *   "/webhooks/guap",
 *   guapLocalHandler(local, {
 *     onCancel: async (ctx) => console.log(`${ctx.customerId} canceled`),
 *   }),
 * );
 * ```
 */
export function guapLocalHandler(
	local: GuapLocal,
	hooks?: GuapWebhookHooks,
): (c: Context) => Promise<Response> {
	const requestHandler = local.handler(hooks);
	return (c: Context) => requestHandler(c.req.raw);
}
