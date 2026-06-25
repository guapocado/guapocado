import {
	type GuapocadoClient,
	type GuapocadoClientOptions,
	GuapocadoError,
	type SubscriptionChange,
	createGuapocadoClient,
} from "@guapocado/sdk";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
export { GUAPOCADO_DOMAIN_EVENTS, billingConfigSchema, defineBilling } from "@guapocado/sdk";
export type { BillingConfig, GuapocadoDomainEventType } from "@guapocado/sdk";

/** Built-in Better Auth session entity sources that can become a Guapocado customerId. */
export type BetterAuthCustomerIdSource = "user" | "organization" | "team";

/** Minimal Better Auth session shape consumed by the Guapocado plugin. */
export type BetterAuthSession = {
	user?: {
		id?: string | null;
		email?: string | null;
		name?: string | null;
	};
	session?: {
		id?: string | null;
		userId?: string | null;
		token?: string | null;
		expiresAt?: Date | string | null;
		createdAt?: Date | string | null;
		updatedAt?: Date | string | null;
		activeOrganizationId?: string | null;
		activeTeamId?: string | null;
		organizationId?: string | null;
		teamId?: string | null;
		[key: string]: unknown;
	};
	organization?: {
		id?: string | null;
	};
	team?: {
		id?: string | null;
	};
};

type BetterAuthOrganizationPlugin = {
	id: "organization";
	options?: {
		teams?: {
			enabled?: boolean;
		};
	};
};

type BetterAuthInitContext = {
	getPlugin(id: string): unknown;
};

/** Options for installing Guapocado into a Better Auth server. */
export type GuapocadoBetterAuthOptions = Omit<GuapocadoClientOptions, "customerId"> & {
	customerId?:
		| BetterAuthCustomerIdSource
		| ((session: BetterAuthSession) => string | null | undefined);
	resolveCustomerId?: (session: BetterAuthSession) => string | null | undefined;
	debug?: boolean;
	mapCustomerId?: (input: {
		source: BetterAuthCustomerIdSource | "custom";
		id: string;
		session: BetterAuthSession;
	}) => string;
	webhook?: {
		enabled?: boolean;
		path?: string;
		publicUrl?: string;
		events?: "*" | string[];
		description?: string;
		autoRegister?: boolean;
	};
};

/** Resolved Guapocado request context for the active Better Auth session. */
export type BetterAuthGuapocadoContext = {
	customerId: string;
	session: BetterAuthSession;
	guap: GuapocadoClient;
	syncCustomer(): Promise<{ id: string; name?: string | null; email?: string | null }>;
};

type EndpointContext = {
	body?: EndpointBody;
	context: {
		session?: BetterAuthSession | null;
		baseURL?: string;
		adapter?: BetterAuthAdapter;
	};
	request?: Request;
	json<T>(body: T, init?: ResponseInit): T;
};

type BetterAuthAdapter = {
	findOne(args: {
		model: string;
		where?: Array<{ field: string; value: unknown; operator?: string }>;
	}): Promise<Record<string, unknown> | null>;
	create(args: {
		model: string;
		data: Record<string, unknown>;
		forceAllowId?: boolean;
	}): Promise<Record<string, unknown>>;
	updateMany(args: {
		model: string;
		where?: Array<{ field: string; value: unknown; operator?: string }>;
		update: Record<string, unknown>;
	}): Promise<unknown>;
};

const customerIdBody = z.object({
	customerId: z.string().optional(),
});

const entitlementBody = customerIdBody.extend({
	key: z.string().min(1),
});

const consumeBody = entitlementBody.extend({
	amount: z.number().int().positive().optional(),
});

const usageSettingsBody = entitlementBody.extend({
	overageEnabled: z.boolean(),
});

const limitSettingsBody = entitlementBody.extend({
	purchased: z.number().nonnegative().optional(),
	autoExpansionEnabled: z.boolean().optional(),
});

const checkoutBody = customerIdBody.extend({
	productKey: z.string().min(1).optional(),
	planKey: z.string().min(1).optional(),
	successUrl: z.string().min(1),
	cancelUrl: z.string().min(1),
});

const subscriptionChangeBody = customerIdBody.extend({
	planKey: z.string().min(1),
});

const contextBody = customerIdBody.extend({
	features: z.array(z.string().min(1)).optional(),
	usage: z.array(z.string().min(1)).optional(),
	limits: z.array(z.string().min(1)).optional(),
	includePlans: z.boolean().optional(),
	includeSubscription: z.boolean().optional(),
	debug: z.boolean().optional(),
});

const guapWebhookBody = z
	.object({
		type: z.string().optional(),
		event: z.string().optional(),
		data: z.unknown().optional(),
	})
	.passthrough()
	.optional();

type WebhookRegistrationState = {
	id: string;
	status: string;
	url: string;
	events: "*" | string[];
	signingSecret: string;
};

type DevRelaySession = {
	receiverId: string;
	publicUrl: string;
	connectUrl: string;
	expiresAt: string;
};

type EndpointBody =
	| z.infer<typeof customerIdBody>
	| z.infer<typeof entitlementBody>
	| z.infer<typeof consumeBody>
	| z.infer<typeof usageSettingsBody>
	| z.infer<typeof limitSettingsBody>
	| z.infer<typeof checkoutBody>
	| z.infer<typeof subscriptionChangeBody>
	| z.infer<typeof contextBody>
	| z.infer<typeof guapWebhookBody>;

// Better Auth automatically adds an `id` primary key to every model, so these
// schemas must NOT declare their own `id` — doing so makes `better-auth generate`
// emit a Drizzle table with a duplicate `id` field (invalid TS). The plugin still
// sets ids explicitly via `forceAllowId: true` and queries the auto `id` field.
const guapocadoPluginSchema = {
	guapocadoWebhookEndpoint: {
		fields: {
			url: { type: "string", required: true },
			events: { type: "string", required: true },
			status: { type: "string", required: true },
			signingSecret: { type: "string", required: true },
			createdAt: { type: "date", required: true },
			updatedAt: { type: "date", required: true },
		},
	},
	guapocadoWebhookEvent: {
		fields: {
			type: { type: "string", required: true },
			payload: { type: "string", required: true },
			signature: { type: "string", required: false },
			receivedAt: { type: "date", required: true },
		},
	},
} as const;

function defaultCustomerId({
	source,
	id,
}: {
	source: BetterAuthCustomerIdSource | "custom";
	id: string;
}): string {
	return `${source}_${id}`.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function resolveCustomerIdSource(
	session: BetterAuthSession,
	source: GuapocadoBetterAuthOptions["customerId"],
): { source: BetterAuthCustomerIdSource | "custom"; id: string } | null {
	if (typeof source === "function") {
		const id = source(session);
		return id ? { source: "custom", id } : null;
	}

	if (source === "organization") {
		const id =
			session.session?.activeOrganizationId ??
			session.session?.organizationId ??
			session.organization?.id;
		return id ? { source, id } : null;
	}

	if (source === "team") {
		const id = session.session?.activeTeamId ?? session.session?.teamId ?? session.team?.id;
		return id ? { source, id } : null;
	}

	const id = session.user?.id;
	return id ? { source: "user", id } : null;
}

function resolveGuapocadoContext(
	session: BetterAuthSession,
	options: GuapocadoBetterAuthOptions,
	overrideCustomerId?: string,
): BetterAuthGuapocadoContext | null {
	const source = options.customerId ?? "organization";
	const resolved = resolveCustomerIdSource(session, source);
	const customerId =
		overrideCustomerId ??
		options.resolveCustomerId?.(session) ??
		(resolved
			? (options.mapCustomerId?.({ ...resolved, session }) ??
				defaultCustomerId({ source: resolved.source, id: resolved.id }))
			: null);
	if (!customerId) return null;

	const guap = createGuapocadoClient({
		apiKey: options.apiKey,
		apiUrl: options.apiUrl,
		customerId,
	});

	return {
		customerId,
		session,
		guap,
		syncCustomer() {
			return guap.customers.create({
				id: customerId,
				name: session.user?.name ?? undefined,
				email: session.user?.email ?? undefined,
				metadata: {
					betterAuthCustomerIdSource: resolved?.source ?? "custom",
					betterAuthCustomerIdSourceId: resolved?.id ?? customerId,
					betterAuthUserId: session.user?.id ?? null,
				},
			});
		},
	};
}

function getSession(ctx: EndpointContext): BetterAuthSession | null {
	return ctx.context.session ?? null;
}

function requireGuapocadoContext(
	ctx: EndpointContext,
	options: GuapocadoBetterAuthOptions,
): BetterAuthGuapocadoContext | null {
	const session = getSession(ctx);
	if (!session) return null;
	const customerId =
		ctx.body && "customerId" in ctx.body && typeof ctx.body.customerId === "string"
			? ctx.body.customerId
			: undefined;
	return resolveGuapocadoContext(session, options, customerId);
}

function getRequiredKey(ctx: EndpointContext): string | null {
	const key = ctx.body && "key" in ctx.body ? ctx.body.key : null;
	return typeof key === "string" && key.trim() ? key : null;
}

function generateLocalId(prefix: string): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `${prefix}_${Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

function resolveWebhookUrl(ctx: EndpointContext, options: GuapocadoBetterAuthOptions): string {
	const configuredUrl = options.webhook?.publicUrl;
	if (configuredUrl) return configuredUrl;
	const forwardedUrl = ctx.request?.headers.get("x-guapocado-public-url");
	if (forwardedUrl) return forwardedUrl;
	if (ctx.request?.url) return ctx.request.url;
	const path = options.webhook?.path ?? "/guap";
	const baseURL = ctx.context.baseURL?.replace(/\/$/, "");
	if (!baseURL) throw new APIError("BAD_REQUEST", { message: "Unable to resolve webhook URL" });
	return `${baseURL}${path}`;
}

function webhookRegistrationKey(options: GuapocadoBetterAuthOptions): string {
	return options.webhook?.path ? `better-auth:${options.webhook.path}` : "better-auth:/guap";
}

function devRelayMode(ctx: EndpointContext): "bootstrap" | "register" | null {
	const mode = ctx.request?.headers.get("x-guapocado-dev-relay");
	return mode === "bootstrap" || mode === "register" ? mode : null;
}

function resolveWebhookApiKey(ctx: EndpointContext, options: GuapocadoBetterAuthOptions): string {
	const headerKey = ctx.request?.headers.get("x-guapocado-key")?.trim();
	return devRelayMode(ctx) && headerKey ? headerKey : options.apiKey;
}

function parseStoredWebhookEvents(value: unknown): "*" | string[] {
	if (Array.isArray(value))
		return value.filter((event): event is string => typeof event === "string");
	if (value === "*") return "*";
	if (typeof value !== "string") return "*";
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((event): event is string => typeof event === "string")
			: "*";
	} catch {
		return "*";
	}
}

function toWebhookRegistrationState(row: unknown): WebhookRegistrationState | null {
	if (!row || typeof row !== "object") return null;
	const value = row as {
		id?: unknown;
		status?: unknown;
		url?: unknown;
		events?: unknown;
		signingSecret?: unknown;
	};
	if (
		typeof value.id !== "string" ||
		typeof value.status !== "string" ||
		typeof value.url !== "string" ||
		typeof value.signingSecret !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		status: value.status,
		url: value.url,
		events: parseStoredWebhookEvents(value.events),
		signingSecret: value.signingSecret,
	};
}

async function createDevRelaySession(
	options: GuapocadoBetterAuthOptions,
	apiKey: string,
): Promise<DevRelaySession> {
	const baseUrl = options.apiUrl?.replace(/\/$/, "") ?? "https://api.guapocado.dev";
	const response = await fetch(`${baseUrl}/v1/dev-relay/session`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-guapocado-key": apiKey,
		},
		body: JSON.stringify({ registrationKey: webhookRegistrationKey(options) }),
	});
	if (!response.ok) {
		throw new GuapocadoError(
			`Could not start Guapocado dev relay: ${response.status} ${await response.text()}`,
			response.status,
		);
	}
	return (await response.json()) as DevRelaySession;
}

async function registerWebhookEndpoint(
	ctx: EndpointContext,
	options: GuapocadoBetterAuthOptions,
	urlOverride?: string,
	apiKeyOverride?: string,
): Promise<WebhookRegistrationState> {
	const adapter = ctx.context.adapter;
	if (!adapter) {
		throw new APIError("BAD_REQUEST", { message: "Better Auth adapter is required" });
	}

	const apiKey = apiKeyOverride ?? resolveWebhookApiKey(ctx, options);
	const url = urlOverride ?? resolveWebhookUrl(ctx, options);
	const events = options.webhook?.events ?? "*";
	const existingByUrl = await adapter.findOne({
		model: "guapocadoWebhookEndpoint",
		where: [{ field: "url", value: url }],
	});

	const guap = createGuapocadoClient({
		apiKey,
		apiUrl: options.apiUrl,
	});
	const registration = await guap.webhooks.register({
		url,
		events,
		description: options.webhook?.description ?? "Better Auth integration",
		integration: "better-auth",
		registrationKey: webhookRegistrationKey(options),
	});
	const now = new Date();
	const data = {
		id: registration.id,
		url: registration.url,
		events: JSON.stringify(registration.events),
		status: registration.status,
		signingSecret: registration.signingSecret,
		createdAt: now,
		updatedAt: now,
	};
	const existingById = await adapter.findOne({
		model: "guapocadoWebhookEndpoint",
		where: [{ field: "id", value: registration.id }],
	});
	if (existingById || existingByUrl) {
		await adapter.updateMany({
			model: "guapocadoWebhookEndpoint",
			where: [{ field: "id", value: String((existingById ?? existingByUrl)?.id) }],
			update: {
				url: data.url,
				events: data.events,
				status: data.status,
				signingSecret: data.signingSecret,
				updatedAt: data.updatedAt,
			},
		});
	} else {
		await adapter.create({
			model: "guapocadoWebhookEndpoint",
			data,
			forceAllowId: true,
		});
	}

	return registration;
}

async function findStoredWebhookEndpoint(
	ctx: EndpointContext,
	options: GuapocadoBetterAuthOptions,
): Promise<WebhookRegistrationState | null> {
	const adapter = ctx.context.adapter;
	if (!adapter) return null;
	const endpointId = ctx.request?.headers.get("guapocado-endpoint-id");
	if (endpointId) {
		const existingById = await adapter.findOne({
			model: "guapocadoWebhookEndpoint",
			where: [{ field: "id", value: endpointId }],
		});
		const registration = toWebhookRegistrationState(existingById);
		if (registration) return registration;
	}

	const url = resolveWebhookUrl(ctx, options);
	const existingByUrl = await adapter.findOne({
		model: "guapocadoWebhookEndpoint",
		where: [{ field: "url", value: url }],
	});
	return toWebhookRegistrationState(existingByUrl);
}

function parseWebhookSignature(signature: string): { timestamp: number; v1: string } | null {
	const parts = Object.fromEntries(
		signature.split(",").map((part) => {
			const [key, value] = part.split("=");
			return [key, value];
		}),
	);
	const timestamp = Number(parts.t);
	const v1 = parts.v1;
	if (!Number.isFinite(timestamp) || !v1) return null;
	return { timestamp, v1 };
}

function hexToBytes(hex: string): ArrayBuffer {
	if (hex.length % 2 !== 0) return new ArrayBuffer(0);
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes.buffer;
}

async function verifyWebhookSignature({
	payload,
	secret,
	signature,
}: {
	payload: string;
	secret: string;
	signature: string | null | undefined;
}): Promise<boolean> {
	if (!signature || !secret) return false;
	const parsed = parseWebhookSignature(signature);
	if (!parsed) return false;
	if (Math.abs(Date.now() / 1000 - parsed.timestamp) > 300) return false;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		"HMAC",
		key,
		hexToBytes(parsed.v1),
		new TextEncoder().encode(`${parsed.timestamp}.${payload}`),
	);
}

async function shortHash(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.slice(0, 8)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => left.localeCompare(right));
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
		.join(",")}}`;
}

function validateBetterAuthPlugins(
	ctx: BetterAuthInitContext,
	options: GuapocadoBetterAuthOptions,
): void {
	const customerId = options.customerId ?? "organization";
	if (typeof customerId === "function" || options.resolveCustomerId) return;
	if (customerId === "user") return;

	const organizationPlugin = ctx.getPlugin("organization") as BetterAuthOrganizationPlugin | null;
	if (!organizationPlugin) {
		throw new Error(
			`@guapocado/better-auth: customerId "${customerId}" requires the Better Auth organization plugin. Add organization() from "better-auth/plugins" before guapocado().`,
		);
	}

	if (customerId === "team" && organizationPlugin.options?.teams?.enabled !== true) {
		throw new Error(
			'@guapocado/better-auth: customerId "team" requires organization({ teams: { enabled: true } }).',
		);
	}
}

function mapGuapocadoApiError(error: unknown): never {
	if (!(error instanceof GuapocadoError)) throw error;

	const status =
		error.status === 400
			? "BAD_REQUEST"
			: error.status === 401
				? "UNAUTHORIZED"
				: error.status === 403
					? "FORBIDDEN"
					: error.status === 404
						? "NOT_FOUND"
						: error.status === 429
							? "TOO_MANY_REQUESTS"
							: "INTERNAL_SERVER_ERROR";

	throw new APIError(status, { message: error.message });
}

async function platformCall<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		mapGuapocadoApiError(error);
	}
}

function nowMs(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

async function timed<T>(
	timings: Record<string, number>,
	label: string,
	operation: () => Promise<T>,
): Promise<T> {
	const start = nowMs();
	try {
		return await operation();
	} finally {
		timings[label] = Math.round(nowMs() - start);
	}
}

/**
 * Creates the Better Auth server plugin that wires Guapocado billing into an
 * auth instance: it maps the active session to a Guapocado customer, registers
 * authenticated `auth.api.guapocado*` endpoints, and (unless disabled) receives
 * and verifies Guapocado webhooks for projection into the auth database.
 *
 * The `customerId` option selects which session entity becomes the billing
 * customer (e.g. `"user"`, `"organization"`, or `"team"`), and the `webhook`
 * option configures the receiving path and registration behavior.
 *
 * @param options - Plugin configuration: the Guapocado `apiKey`, a `customerId`
 *   source or resolver, optional `mapCustomerId`/`resolveCustomerId` overrides,
 *   a `webhook` block, a `debug` flag, and any other `@guapocado/sdk` client
 *   options.
 * @returns A Better Auth server plugin to include in `betterAuth({ plugins })`.
 * @example
 * ```typescript
 * import { guapocado } from "@guapocado/better-auth";
 * import { betterAuth } from "better-auth";
 * import { organization } from "better-auth/plugins";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     organization({ teams: { enabled: true } }),
 *     guapocado({
 *       apiKey: process.env.GUAPOCADO_API_KEY!,
 *       customerId: "organization",
 *       webhook: { path: "/guap" },
 *     }),
 *   ],
 * });
 * ```
 */
export function guapocado(options: GuapocadoBetterAuthOptions) {
	return {
		id: "guapocado",
		schema: guapocadoPluginSchema,
		init(ctx) {
			validateBetterAuthPlugins(ctx, options);
		},
		endpoints: {
			guapocadoWebhookStatus: createAuthEndpoint(
				options.webhook?.path ?? "/guap",
				{ method: "GET" },
				async (ctx) => {
					if (options.webhook?.enabled === false) {
						return ctx.json({ enabled: false });
					}
					const endpointCtx = ctx as EndpointContext;
					const relayBootstrap =
						endpointCtx.request?.headers.get("x-guapocado-dev-relay") === "bootstrap";
					const apiKey = resolveWebhookApiKey(endpointCtx, options);
					const relay = relayBootstrap
						? await platformCall(() => createDevRelaySession(options, apiKey))
						: null;
					const registration = await platformCall(() =>
						registerWebhookEndpoint(endpointCtx, options, relay?.publicUrl, apiKey),
					);
					return ctx.json({
						enabled: true,
						id: registration.id,
						status: registration.status,
						url: registration.url,
						events: registration.events,
						relay,
					});
				},
			),
			guapocadoWebhook: createAuthEndpoint(
				options.webhook?.path ?? "/guap",
				{ method: "POST", body: guapWebhookBody },
				async (ctx) => {
					if (options.webhook?.enabled === false) {
						throw new APIError("NOT_FOUND", { message: "Webhook disabled" });
					}
					const registration =
						(await platformCall(() =>
							findStoredWebhookEndpoint(ctx as EndpointContext, options),
						)) ??
						(options.webhook?.autoRegister === false
							? null
							: await platformCall(() => registerWebhookEndpoint(ctx as EndpointContext, options)));
					const body = (ctx as EndpointContext).body;
					if (!body) throw new APIError("BAD_REQUEST", { message: "Missing webhook payload" });
					const payload = stableStringify(body);

					const verified = await verifyWebhookSignature({
						payload,
						secret: registration?.signingSecret ?? "",
						signature: (ctx as EndpointContext).request?.headers.get("guapocado-signature"),
					});
					if (!verified) {
						if (options.debug) {
							const signature = (ctx as EndpointContext).request?.headers.get(
								"guapocado-signature",
							);
							const parsed = signature ? parseWebhookSignature(signature) : null;
							console.error("[guapocado] invalid webhook signature", {
								hasSignature: !!signature,
								hasSecret: !!registration?.signingSecret,
								registeredEndpointId: registration?.id ?? null,
								senderEndpointId:
									(ctx as EndpointContext).request?.headers.get("guapocado-endpoint-id") ?? null,
								payloadLength: payload.length,
								payloadHash: await shortHash(payload),
								timestampAgeSeconds: parsed
									? Math.round(Date.now() / 1000 - parsed.timestamp)
									: null,
							});
						}
						throw new APIError("UNAUTHORIZED", { message: "Invalid webhook signature" });
					}

					const adapter = (ctx as EndpointContext).context.adapter;
					const type =
						typeof body === "object" && body && "type" in body ? String(body.type ?? "") : "";
					if (adapter && type) {
						await adapter.create({
							model: "guapocadoWebhookEvent",
							forceAllowId: true,
							data: {
								id: generateLocalId("gwhe"),
								type,
								payload,
								signature:
									(ctx as EndpointContext).request?.headers.get("guapocado-signature") ?? null,
								receivedAt: new Date(),
							},
						});
					}

					return ctx.json({ received: true });
				},
			),
			guapocadoCustomer: createAuthEndpoint(
				"/guapocado/customer",
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					if (!context) return ctx.json(null);
					return ctx.json({ customerId: context.customerId });
				},
			),
			guapocadoSyncCustomer: createAuthEndpoint(
				"/guapocado/customer",
				{ method: "POST", body: customerIdBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					const customer = await platformCall(() => context.syncCustomer());
					return ctx.json({ customerId: context.customerId, customer });
				},
			),
			guapocadoContext: createAuthEndpoint(
				"/guapocado/context",
				{ method: "POST", body: contextBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });

					const featureKeys = ctx.body?.features ?? [];
					const usageKeys = ctx.body?.usage ?? [];
					const limitKeys = ctx.body?.limits ?? [];
					const includePlans = ctx.body?.includePlans ?? true;
					const includeSubscription = ctx.body?.includeSubscription ?? true;
					const debug = options.debug === true || ctx.body?.debug === true;
					const timings: Record<string, number> = {};
					const startedAt = nowMs();

					const billingContext = await platformCall(() =>
						timed(timings, "platform.context", () =>
							context.guap.context({
								customer: {
									id: context.customerId,
									name: context.session.user?.name ?? undefined,
									email: context.session.user?.email ?? undefined,
									metadata: {
										betterAuthUserId: context.session.user?.id ?? null,
									},
								},
								features: featureKeys,
								usage: usageKeys,
								limits: limitKeys,
								includePlans,
								includeSubscription,
							}),
						),
					);

					const totalMs = Math.round(nowMs() - startedAt);
					if (debug) {
						console.info(
							"[guapocado] context timings",
							JSON.stringify({ customerId: context.customerId, totalMs, timings }),
						);
					}

					return ctx.json({
						customerId: context.customerId,
						customer: billingContext.customer,
						features: billingContext.features,
						usage: billingContext.usage,
						limits: billingContext.limits,
						plans: billingContext.plans,
						subscription: billingContext.subscription,
						...(debug ? { _debug: { totalMs, timings } } : {}),
					});
				},
			),
			guapocadoHas: createAuthEndpoint(
				"/guapocado/has",
				{ method: "POST", body: entitlementBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					const allowed = await platformCall(() => context.guap.has(key));
					return ctx.json({ customerId: context.customerId, allowed });
				},
			),
			guapocadoUsageBalance: createAuthEndpoint(
				"/guapocado/usage/balance",
				{ method: "POST", body: entitlementBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					const usage = await platformCall(() => context.guap.usage.balance(key));
					return ctx.json({ customerId: context.customerId, ...usage });
				},
			),
			guapocadoLimit: createAuthEndpoint(
				"/guapocado/limit",
				{ method: "POST", body: entitlementBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					const limit = await platformCall(() => context.guap.limit(key));
					return ctx.json({ customerId: context.customerId, ...limit });
				},
			),
			guapocadoPlans: createAuthEndpoint(
				"/guapocado/plans",
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					const session = getSession(ctx as EndpointContext);
					if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					const guap = createGuapocadoClient({
						apiKey: options.apiKey,
						apiUrl: options.apiUrl,
					});
					const plans = await platformCall(() => guap.plans.list());
					return ctx.json({ plans });
				},
			),
			guapocadoCurrentSubscription: createAuthEndpoint(
				"/guapocado/subscription",
				{ method: "POST", body: customerIdBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					const subscription = await platformCall(() => context.guap.subscription.current());
					return ctx.json({ customerId: context.customerId, subscription });
				},
			),
			guapocadoChangeSubscription: createAuthEndpoint(
				"/guapocado/subscription/change",
				{ method: "POST", body: subscriptionChangeBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const planKey = ctx.body?.planKey;
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!planKey) throw new APIError("BAD_REQUEST", { message: "planKey is required" });
					const subscription = await platformCall<SubscriptionChange>(() =>
						context.guap.subscription.change(planKey),
					);
					return ctx.json({ customerId: context.customerId, subscription });
				},
			),
			guapocadoLimitConfigure: createAuthEndpoint(
				"/guapocado/limit/settings",
				{ method: "POST", body: limitSettingsBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					const limit = await platformCall(() =>
						context.guap.limits.configure(key, {
							purchased: ctx.body?.purchased,
							autoExpansionEnabled: ctx.body?.autoExpansionEnabled,
						}),
					);
					return ctx.json({ customerId: context.customerId, ...limit });
				},
			),
			guapocadoUsageConsume: createAuthEndpoint(
				"/guapocado/usage/consume",
				{ method: "POST", body: consumeBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					const amount = ctx.body?.amount ?? 1;
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					if (typeof amount !== "number") {
						throw new APIError("BAD_REQUEST", { message: "amount must be a number" });
					}
					const usage = await platformCall(() => context.guap.usage.consume(key, amount));
					return ctx.json({ customerId: context.customerId, ...usage });
				},
			),
			guapocadoUsageConfigure: createAuthEndpoint(
				"/guapocado/usage/settings",
				{ method: "POST", body: usageSettingsBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					const overageEnabled = ctx.body?.overageEnabled;
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					if (typeof overageEnabled !== "boolean") {
						throw new APIError("BAD_REQUEST", {
							message: "overageEnabled must be a boolean",
						});
					}
					const usage = await platformCall(() =>
						context.guap.usage.configure(key, { overageEnabled }),
					);
					return ctx.json({ customerId: context.customerId, ...usage });
				},
			),
			guapocadoUsageRefund: createAuthEndpoint(
				"/guapocado/usage/refund",
				{ method: "POST", body: consumeBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const key = getRequiredKey(ctx as EndpointContext);
					const amount = ctx.body?.amount ?? 1;
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!key) throw new APIError("BAD_REQUEST", { message: "key is required" });
					if (typeof amount !== "number") {
						throw new APIError("BAD_REQUEST", { message: "amount must be a number" });
					}
					const usage = await platformCall(() => context.guap.usage.refund(key, amount));
					return ctx.json({ customerId: context.customerId, ...usage });
				},
			),
			guapocadoCheckout: createAuthEndpoint(
				"/guapocado/checkout",
				{ method: "POST", body: checkoutBody, use: [sessionMiddleware] },
				async (ctx) => {
					const context = requireGuapocadoContext(ctx as EndpointContext, options);
					const productKey = ctx.body?.productKey ?? ctx.body?.planKey;
					const successUrl = ctx.body?.successUrl;
					const cancelUrl = ctx.body?.cancelUrl;
					if (!context) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
					if (!productKey || !successUrl || !cancelUrl) {
						throw new APIError("BAD_REQUEST", {
							message: "productKey, successUrl, and cancelUrl are required",
						});
					}
					const session = await platformCall(() =>
						context.guap.checkout.create({
							productKey,
							successUrl,
							cancelUrl,
						}),
					);
					return ctx.json({ customerId: context.customerId, ...session });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
