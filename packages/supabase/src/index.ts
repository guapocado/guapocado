import {
	type BillingContextInput,
	type CustomerInput,
	type GuapocadoClientOptions,
	GuapocadoError,
	type WebhookRegistrationInput,
	createGuapocadoClient,
} from "@guapocado/sdk";

type JsonObject = Record<string, unknown>;

type DenoGlobal = {
	env?: {
		get(name: string): string | undefined;
	};
	serve?: (handler: GuapocadoSupabaseHandler) => unknown;
};

const DEFAULT_CORS_METHODS = ["GET", "POST", "OPTIONS"];
const DEFAULT_CORS_HEADERS = ["authorization", "x-client-info", "apikey", "content-type"];
const ROUTE_STARTS = new Set([
	"checkout",
	"context",
	"customers",
	"entitlements",
	"features",
	"health",
	"limits",
	"plans",
	"subscription",
	"subscriptions",
	"usage",
	"webhooks",
]);

/** Standard Deno/Supabase HTTP handler signature. */
export type GuapocadoSupabaseHandler = (request: Request) => Response | Promise<Response>;

/** Static value or request-aware resolver accepted by the Supabase handler. */
export type GuapocadoSupabaseResolver<T> = T | ((request: Request) => T | Promise<T>);

/** CORS settings for browser-callable Supabase Edge Functions. */
export type GuapocadoSupabaseCorsOptions = {
	origin?:
		| string
		| string[]
		| ((origin: string | null, request: Request) => string | null | undefined);
	methods?: string[];
	allowHeaders?: string[];
	exposeHeaders?: string[];
	maxAge?: number;
	credentials?: boolean;
};

/** Optional webhook registration route settings. Disabled unless explicitly enabled. */
export type GuapocadoSupabaseWebhookOptions = {
	enabled?: boolean;
	registrationKey?: GuapocadoSupabaseResolver<string | null | undefined>;
};

/** Options for creating the Guapocado Supabase Edge Function handler. */
export type GuapocadoSupabaseHandlerOptions = Omit<
	GuapocadoClientOptions,
	"apiKey" | "customerId"
> & {
	apiKey?: GuapocadoSupabaseResolver<string | null | undefined>;
	customerId?: GuapocadoSupabaseResolver<string | null | undefined>;
	allowRequestCustomerId?: boolean;
	cors?: boolean | GuapocadoSupabaseCorsOptions;
	routePrefix?: string;
	webhooks?: boolean | GuapocadoSupabaseWebhookOptions;
	onError?: (error: unknown, request: Request) => void | Promise<void>;
};

function denoGlobal(): DenoGlobal | undefined {
	return (globalThis as typeof globalThis & { Deno?: DenoGlobal }).Deno;
}

function readDenoEnv(name: string): string | undefined {
	return denoGlobal()?.env?.get(name);
}

function optionalString(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveValue<T>(
	request: Request,
	resolver: GuapocadoSupabaseResolver<T> | undefined,
): Promise<T | undefined> {
	if (typeof resolver === "function") {
		return (resolver as (request: Request) => T | Promise<T>)(request);
	}
	return resolver;
}

function jsonResponse(
	body: unknown,
	status: number,
	corsHeaders: HeadersInit,
	extraHeaders?: HeadersInit,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			...corsHeaders,
			...extraHeaders,
		},
	});
}

function errorResponse(message: string, status: number, corsHeaders: HeadersInit): Response {
	return jsonResponse({ error: message }, status, corsHeaders);
}

function makeCorsHeaders(
	request: Request,
	cors: boolean | GuapocadoSupabaseCorsOptions | undefined,
): HeadersInit {
	if (cors === false) return {};

	const options = typeof cors === "object" ? cors : {};
	const requestOrigin = request.headers.get("origin");
	const configuredOrigin = options.origin ?? "*";
	let origin: string | null | undefined;

	if (typeof configuredOrigin === "function") {
		origin = configuredOrigin(requestOrigin, request);
	} else if (Array.isArray(configuredOrigin)) {
		origin = requestOrigin && configuredOrigin.includes(requestOrigin) ? requestOrigin : undefined;
	} else if (configuredOrigin === "*" && options.credentials && requestOrigin) {
		origin = requestOrigin;
	} else {
		origin = configuredOrigin;
	}

	const headers: Record<string, string> = {};
	if (origin) headers["access-control-allow-origin"] = origin;
	headers["access-control-allow-methods"] = (options.methods ?? DEFAULT_CORS_METHODS).join(", ");
	headers["access-control-allow-headers"] = (options.allowHeaders ?? DEFAULT_CORS_HEADERS).join(
		", ",
	);
	if (options.exposeHeaders?.length) {
		headers["access-control-expose-headers"] = options.exposeHeaders.join(", ");
	}
	if (typeof options.maxAge === "number") {
		headers["access-control-max-age"] = String(options.maxAge);
	}
	if (options.credentials) headers["access-control-allow-credentials"] = "true";
	if (Array.isArray(configuredOrigin) || typeof configuredOrigin === "function") {
		headers.vary = "Origin";
	}
	return headers;
}

function trimRoutePrefix(pathname: string, routePrefix: string | undefined): string {
	if (!routePrefix) return pathname;
	const normalizedPrefix = routePrefix.startsWith("/") ? routePrefix : `/${routePrefix}`;
	if (pathname === normalizedPrefix) return "/";
	if (pathname.startsWith(`${normalizedPrefix}/`)) {
		return pathname.slice(normalizedPrefix.length);
	}
	return pathname;
}

function routeSegments(url: URL, routePrefix: string | undefined): string[] {
	const pathname = trimRoutePrefix(url.pathname, routePrefix);
	const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	const functionsIndex = segments.findIndex(
		(segment, index) => segment === "functions" && segments[index + 1] === "v1",
	);

	if (functionsIndex >= 0 && segments.length > functionsIndex + 2) {
		return segments.slice(functionsIndex + 3);
	}

	const routeStartIndex = segments.findIndex((segment) => ROUTE_STARTS.has(segment));
	if (routeStartIndex < 0 && segments.length === 1) return [];
	return routeStartIndex >= 0 ? segments.slice(routeStartIndex) : segments;
}

async function readBody(request: Request): Promise<JsonObject> {
	if (request.method === "GET" || request.method === "HEAD") return {};

	const text = await request.text();
	if (!text.trim()) return {};

	try {
		const parsed = JSON.parse(text) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("JSON body must be an object");
		}
		return parsed as JsonObject;
	} catch {
		throw new GuapocadoError("Request body must be valid JSON", 400);
	}
}

function bodyString(body: JsonObject, key: string): string | undefined {
	return optionalString(typeof body[key] === "string" ? body[key] : undefined);
}

function bodyNumber(body: JsonObject, key: string): number | undefined {
	const value = body[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bodyBoolean(body: JsonObject, key: string): boolean | undefined {
	const value = body[key];
	return typeof value === "boolean" ? value : undefined;
}

function bodyStringArray(body: JsonObject, key: string): string[] | undefined {
	const value = body[key];
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is string => typeof item === "string");
}

function bodyObject<T extends JsonObject>(body: JsonObject, key: string): T | undefined {
	const value = body[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as T;
}

function requestCustomerId(url: URL, body: JsonObject): string | undefined {
	return optionalString(url.searchParams.get("customerId")) ?? bodyString(body, "customerId");
}

async function resolveCustomerId(
	request: Request,
	url: URL,
	body: JsonObject,
	options: GuapocadoSupabaseHandlerOptions,
): Promise<string | undefined> {
	const resolved = optionalString(await resolveValue(request, options.customerId));
	if (resolved) return resolved;
	if (options.allowRequestCustomerId === false) return undefined;
	return requestCustomerId(url, body);
}

function requireCustomerId(customerId: string | undefined): string {
	if (!customerId) throw new GuapocadoError("customerId is required", 400);
	return customerId;
}

function webhookOptions(options: GuapocadoSupabaseHandlerOptions): GuapocadoSupabaseWebhookOptions {
	if (options.webhooks === true) return { enabled: true };
	if (typeof options.webhooks === "object") return options.webhooks;
	return { enabled: false };
}

function healthResponse(corsHeaders: HeadersInit): Response {
	return jsonResponse({ status: "ok", integration: "supabase" }, 200, corsHeaders);
}

async function handleRequest(
	request: Request,
	options: GuapocadoSupabaseHandlerOptions,
	corsHeaders: HeadersInit,
): Promise<Response> {
	const url = new URL(request.url);
	const segments = routeSegments(url, options.routePrefix);
	const [resource, key, action] = segments;

	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders });
	}

	if (resource === undefined || resource === "health") {
		return healthResponse(corsHeaders);
	}

	const body = await readBody(request);
	const apiKey = optionalString(
		await resolveValue(request, options.apiKey ?? (() => readDenoEnv("GUAPOCADO_API_KEY"))),
	);
	if (!apiKey) return errorResponse("GUAPOCADO_API_KEY is required", 500, corsHeaders);

	const customerId = await resolveCustomerId(request, url, body, options);
	const guap = createGuapocadoClient({
		...options,
		apiKey,
		customerId,
	});

	if (request.method === "GET" && resource === "plans") {
		return jsonResponse({ plans: await guap.plans.list() }, 200, corsHeaders);
	}

	if (request.method === "POST" && resource === "customers") {
		const customer = await guap.customers.create(body as CustomerInput);
		return jsonResponse({ customer }, 200, corsHeaders);
	}

	if (
		request.method === "GET" &&
		((resource === "features" && key) ||
			(resource === "entitlements" && key && (action === undefined || action === "has")))
	) {
		const scopedCustomerId = requireCustomerId(customerId);
		const hasAccess = await guap.has(key, { customerId: scopedCustomerId });
		return jsonResponse({ key, hasAccess }, 200, corsHeaders);
	}

	if (
		request.method === "GET" &&
		((resource === "limits" && key) || (resource === "entitlements" && key && action === "limit"))
	) {
		const scopedCustomerId = requireCustomerId(customerId);
		const limit = await guap.limit(key, { customerId: scopedCustomerId });
		return jsonResponse({ key, ...limit }, 200, corsHeaders);
	}

	if (resource === "limits" && key && request.method === "POST" && action === "settings") {
		const scopedCustomerId = requireCustomerId(customerId);
		const limit = await guap.limits.configure(
			key,
			{
				purchased: bodyNumber(body, "purchased"),
				autoExpansionEnabled: bodyBoolean(body, "autoExpansionEnabled"),
			},
			{ customerId: scopedCustomerId },
		);
		return jsonResponse({ key, ...limit }, 200, corsHeaders);
	}

	if (resource === "usage" && key && request.method === "GET") {
		const scopedCustomerId = requireCustomerId(customerId);
		const usage = await guap.usage.balance(key, { customerId: scopedCustomerId });
		return jsonResponse({ key, ...usage }, 200, corsHeaders);
	}

	if (resource === "usage" && key && request.method === "POST") {
		const scopedCustomerId = requireCustomerId(customerId);
		const amount = bodyNumber(body, "amount") ?? 1;
		if (action === "consume" || action === undefined) {
			const usage = await guap.usage.consume(key, amount, { customerId: scopedCustomerId });
			return jsonResponse({ key, ...usage }, 200, corsHeaders);
		}
		if (action === "refund") {
			const usage = await guap.usage.refund(key, amount, { customerId: scopedCustomerId });
			return jsonResponse({ key, ...usage }, 200, corsHeaders);
		}
		if (action === "settings") {
			const overageEnabled = bodyBoolean(body, "overageEnabled");
			if (overageEnabled === undefined) {
				return errorResponse("overageEnabled is required", 400, corsHeaders);
			}
			const usage = await guap.usage.configure(
				key,
				{ overageEnabled },
				{ customerId: scopedCustomerId },
			);
			return jsonResponse({ key, ...usage }, 200, corsHeaders);
		}
	}

	if (resource === "context" && request.method === "POST") {
		const scopedCustomerId = requireCustomerId(customerId);
		const input: BillingContextInput = {
			customerId: scopedCustomerId,
			customer: bodyObject<CustomerInput>(body, "customer"),
			features: bodyStringArray(body, "features"),
			usage: bodyStringArray(body, "usage"),
			limits: bodyStringArray(body, "limits"),
			includePlans: bodyBoolean(body, "includePlans"),
			includeSubscription: bodyBoolean(body, "includeSubscription"),
		};
		return jsonResponse(await guap.context(input), 200, corsHeaders);
	}

	if (resource === "checkout" && request.method === "POST") {
		const scopedCustomerId = requireCustomerId(customerId);
		const productKey = bodyString(body, "productKey") ?? bodyString(body, "planKey");
		if (!productKey) return errorResponse("productKey is required", 400, corsHeaders);
		const successUrl = bodyString(body, "successUrl");
		const cancelUrl = bodyString(body, "cancelUrl");
		if (!successUrl || !cancelUrl) {
			return errorResponse("successUrl and cancelUrl are required", 400, corsHeaders);
		}
		const checkout = await guap.checkout.create({
			productKey,
			successUrl,
			cancelUrl,
			customerId: scopedCustomerId,
		});
		return jsonResponse(checkout, 200, corsHeaders);
	}

	if (
		request.method === "GET" &&
		(resource === "subscription" || (resource === "subscriptions" && action === undefined))
	) {
		const scopedCustomerId = requireCustomerId(customerId);
		const subscription = await guap.subscription.current({ customerId: scopedCustomerId });
		return jsonResponse({ subscription }, 200, corsHeaders);
	}

	if (
		request.method === "POST" &&
		((resource === "subscription" && key === "change") ||
			(resource === "subscriptions" && key === "change"))
	) {
		const scopedCustomerId = requireCustomerId(customerId);
		const planKey = bodyString(body, "planKey") ?? bodyString(body, "productKey");
		if (!planKey) return errorResponse("planKey is required", 400, corsHeaders);
		const subscription = await guap.subscription.change(planKey, { customerId: scopedCustomerId });
		return jsonResponse({ subscription }, 200, corsHeaders);
	}

	if (
		request.method === "POST" &&
		resource === "webhooks" &&
		key === "register" &&
		webhookOptions(options).enabled
	) {
		const webhookConfig = webhookOptions(options);
		const registrationKey = optionalString(
			await resolveValue(request, webhookConfig.registrationKey),
		);
		const endpoint: WebhookRegistrationInput = {
			url: bodyString(body, "url") ?? "",
			events:
				bodyString(body, "events") === "*" ? "*" : (bodyStringArray(body, "events") ?? undefined),
			description: bodyString(body, "description"),
			integration: bodyString(body, "integration") ?? "supabase",
			registrationKey,
		};
		const webhook = await guap.webhooks.register(endpoint);
		return jsonResponse({ webhook }, 200, corsHeaders);
	}

	return errorResponse("Route not found", 404, corsHeaders);
}

/**
 * Creates a Supabase Edge Function request handler that exposes the common
 * Guapocado HTTP actions (health, feature checks, limits, usage, context,
 * checkout, plans, subscription, and customer sync) as a small JSON API.
 *
 * The returned handler reads the server key from the `apiKey` option or, by
 * default, the `GUAPOCADO_API_KEY` Supabase secret, applies CORS, maps
 * `GuapocadoError`s to their original status, and falls back to a 500 for any
 * other failure. Webhook registration is opt-in via the `webhooks` option.
 *
 * @param options - Handler configuration: `apiKey`/`customerId` resolvers,
 *   `allowRequestCustomerId`, `cors`, `routePrefix`, `webhooks`, an `onError`
 *   hook, and any other `@guapocado/sdk` client options. Defaults to an empty
 *   object that relies on Supabase secrets.
 * @returns A `(request: Request) => Promise<Response>` handler suitable for
 *   `Deno.serve()`.
 * @example
 * ```typescript
 * import { createGuapocadoSupabaseHandler } from "npm:@guapocado/supabase";
 * import { createClient } from "npm:@supabase/supabase-js@2";
 *
 * const handler = createGuapocadoSupabaseHandler({
 *   allowRequestCustomerId: false,
 *   customerId: async (request) => {
 *     const authorization = request.headers.get("Authorization");
 *     if (!authorization) return undefined;
 *     const supabase = createClient(
 *       Deno.env.get("SUPABASE_URL") ?? "",
 *       Deno.env.get("SUPABASE_ANON_KEY") ?? "",
 *       { global: { headers: { Authorization: authorization } } },
 *     );
 *     const { data } = await supabase.auth.getUser();
 *     return data.user?.id;
 *   },
 * });
 *
 * Deno.serve(handler);
 * ```
 */
export function createGuapocadoSupabaseHandler(
	options: GuapocadoSupabaseHandlerOptions = {},
): GuapocadoSupabaseHandler {
	return async (request) => {
		const corsHeaders = makeCorsHeaders(request, options.cors);
		try {
			return await handleRequest(request, options, corsHeaders);
		} catch (error) {
			await options.onError?.(error, request);
			if (error instanceof GuapocadoError) {
				return jsonResponse(
					{ error: error.message, requestId: error.requestId },
					error.status,
					corsHeaders,
				);
			}
			return errorResponse("Internal server error", 500, corsHeaders);
		}
	};
}

/**
 * Convenience wrapper that builds a Guapocado Supabase handler with
 * {@link createGuapocadoSupabaseHandler} and immediately starts serving it with
 * `Deno.serve()`, so a Supabase Edge Function can be a single call.
 *
 * Throws if invoked outside a Deno runtime where `Deno.serve` is unavailable.
 *
 * @param options - The same handler configuration accepted by
 *   {@link createGuapocadoSupabaseHandler}. Defaults to an empty object that
 *   reads the `GUAPOCADO_API_KEY` Supabase secret.
 * @example
 * ```typescript
 * import { serveGuapocado } from "npm:@guapocado/supabase";
 *
 * serveGuapocado({
 *   cors: true,
 *   webhooks: { enabled: true },
 * });
 * ```
 */
export function serveGuapocado(options: GuapocadoSupabaseHandlerOptions = {}): void {
	const deno = denoGlobal();
	if (!deno?.serve) throw new Error("Deno.serve is not available in this runtime");
	deno.serve(createGuapocadoSupabaseHandler(options));
}

/** Ready-to-serve default handler that reads `GUAPOCADO_API_KEY` from Supabase secrets. */
export const handler = createGuapocadoSupabaseHandler();

/** Alias for runtimes or adapters that expect an `ALL` method export. */
export const ALL = handler;

export default handler;
