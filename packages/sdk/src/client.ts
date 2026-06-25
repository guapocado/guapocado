/** Options for constructing a Guapocado SDK client. */
export type BillingClientOptions = {
	apiKey: string;
	customerId?: string;
	/** Override the Guapocado API base URL. Defaults to https://api.guapocado.dev. */
	apiUrl?: string;
	/** Preferred local read-model adapter. Reads check this adapter before API fallback. */
	adapter?: GuapAdapter;
	/** @deprecated Use adapter. */
	readModel?: GuapocadoReadModel;
};

/** Options for constructing a Guapocado SDK client. */
export type GuapocadoClientOptions = BillingClientOptions;

/** Customer payload accepted when creating or syncing a Guapocado customer. */
export type CustomerInput = {
	id?: string;
	name?: string;
	email?: string;
	stripeCustomerId?: string;
	metadata?: Record<string, unknown>;
};

/** Customer record returned by the Guapocado API. */
export type Customer = {
	id: string;
	name?: string | null;
	email?: string | null;
};

/** Product plan returned by the Guapocado API. */
export type BillingPlan = {
	id: string;
	key: string;
	name?: string | null;
	config?: unknown;
	stripeProductId?: string | null;
	stripePriceId?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
};

/** Product pricing fields returned inside a product config. */
export type ProductPricing = {
	mode?: "recurring" | "one_time";
	type?: "flat" | "per_seat" | "usage";
	amount?: number;
	currency?: string;
	frequency?: "month" | "year";
	/** @deprecated Use frequency. */
	interval?: "month" | "year";
};

/** Product config returned by the Guapocado API. */
export type ProductConfig = {
	pricing?: ProductPricing;
	entitlements?: Record<string, unknown>;
	[key: string]: unknown;
};

/** Product record returned by the Guapocado API. */
export type Product = Omit<BillingPlan, "config"> & {
	config?: ProductConfig | null;
};

/** Product plan returned by the Guapocado API. */
export type GuapocadoPlan = Product;

/** Purchase status values normalized from completed one-time checkout payments. */
export type PurchaseStatus = "pending" | "completed" | "failed" | "refunded";

/** One-time purchase record returned by the Guapocado API. */
export type Purchase = {
	id: string;
	customerId: string;
	productKey: string;
	status: PurchaseStatus;
	amount: number;
	currency: string;
	quantity: number;
	stripeCheckoutSessionId?: string | null;
	stripePaymentIntentId?: string | null;
	completedAt?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
};

/** Subscription status values normalized from the platform billing backend. */
export type SubscriptionStatus =
	| "active"
	| "trialing"
	| "past_due"
	| "canceled"
	| "unpaid"
	| "incomplete";

/** Customer subscription record returned by the Guapocado API. */
export type Subscription = {
	id: string;
	customerId: string;
	planKey: string;
	status: SubscriptionStatus;
	stripeSubscriptionId?: string | null;
	currentPeriodEnd?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
};

/** Customer subscription record returned by the Guapocado API. */
export type GuapocadoSubscription = Subscription;

/** Result returned when changing a customer's subscription plan. */
export type SubscriptionChange = Subscription & {
	changed: boolean;
};

/** Result returned when changing a customer's subscription plan. */
export type GuapocadoSubscriptionChange = SubscriptionChange;

/** Per-request customer override accepted by customer-scoped SDK calls. */
export type CustomerScopedOptions = {
	customerId?: string;
};

/** Options for `usage.consume`, including an idempotency key for retry-safe consumption. */
export type ConsumeOptions = CustomerScopedOptions & {
	/** Dedupe key — repeated consume calls with the same key are applied at most once. */
	idempotencyKey?: string;
};

/** Input for fetching a consolidated customer entitlement context. */
export type BillingContextInput = CustomerScopedOptions & {
	customer?: CustomerInput;
	features?: string[];
	usage?: string[];
	limits?: string[];
	includePlans?: boolean;
	includeSubscription?: boolean;
};

/** Consolidated customer context returned by the platform context endpoint. */
export type BillingContext = {
	customerId: string;
	customer?: Customer;
	features: Record<string, boolean>;
	usage: Record<string, UsageBalance>;
	limits: Record<string, LimitBalance>;
	plans: Product[];
	subscription: Subscription | null;
};

/** Input for fetching a consolidated customer entitlement context. */
export type GuapocadoContextInput = BillingContextInput;

/** Consolidated customer context returned by the platform context endpoint. */
export type GuapocadoContext = BillingContext;

/** Result returned by a local read-model lookup. */
export type GuapocadoReadModelResult<T> =
	| {
			found: true;
			value: T;
	  }
	| {
			found: false;
			reason?: string;
	  };

/** Operation names used by local read-model hooks. */
export type GuapocadoReadModelOperation =
	| "context"
	| "has"
	| "limit"
	| "plans.list"
	| "purchases.list"
	| "subscription.current"
	| "usage.balance";

/** Error context passed when a local read-model read or true-up fails. */
export type GuapocadoReadModelErrorContext = {
	operation: GuapocadoReadModelOperation;
	phase: "read" | "trueUp";
};

/** Event emitted after an API fallback returns data that can true up a local read model. */
export type GuapocadoReadModelTrueUpEvent =
	| {
			operation: "context";
			input: BillingContextInput & { customerId: string };
			value: BillingContext;
	  }
	| {
			operation: "has";
			customerId: string;
			key: string;
			value: boolean;
	  }
	| {
			operation: "limit";
			customerId: string;
			key: string;
			value: LimitBalance;
	  }
	| {
			operation: "plans.list";
			value: Product[];
	  }
	| {
			operation: "purchases.list";
			customerId: string;
			value: Purchase[];
	  }
	| {
			operation: "subscription.current";
			customerId: string;
			value: Subscription | null;
	  }
	| {
			operation: "usage.balance";
			customerId: string;
			key: string;
			value: UsageBalance;
	  };

/** Optional local read-model adapter. Reads can hit local storage first and true up after API fallback. */
export type GuapocadoReadModel = {
	has?(input: { customerId: string; key: string }): Promise<GuapocadoReadModelResult<boolean>>;
	limit?(input: { customerId: string; key: string }): Promise<
		GuapocadoReadModelResult<LimitBalance>
	>;
	usageBalance?(input: { customerId: string; key: string }): Promise<
		GuapocadoReadModelResult<UsageBalance>
	>;
	currentSubscription?(input: { customerId: string }): Promise<
		GuapocadoReadModelResult<Subscription | null>
	>;
	plans?(): Promise<GuapocadoReadModelResult<Product[]>>;
	purchases?(input: { customerId: string }): Promise<GuapocadoReadModelResult<Purchase[]>>;
	context?(
		input: BillingContextInput & { customerId: string },
	): Promise<GuapocadoReadModelResult<BillingContext>>;
	trueUp?(event: GuapocadoReadModelTrueUpEvent): Promise<void>;
	onError?(error: unknown, context: GuapocadoReadModelErrorContext): void;
};

/** Optional local read-model adapter. Reads can hit local storage first and true up after API fallback. */
export type GuapAdapter = GuapocadoReadModel;

/** Result returned by a Guap local adapter lookup. */
export type GuapAdapterResult<T> = GuapocadoReadModelResult<T>;

/** Operation names used by Guap local adapter hooks. */
export type GuapAdapterOperation = GuapocadoReadModelOperation;

/** Error context passed when a Guap local adapter read or true-up fails. */
export type GuapAdapterErrorContext = GuapocadoReadModelErrorContext;

/** Event emitted after an API fallback returns data that can true up a Guap local adapter. */
export type GuapAdapterTrueUpEvent = GuapocadoReadModelTrueUpEvent;

/** Effective balance state for a metered entitlement. */
export type UsageBalance = {
	balance: number;
	included: number;
	consumed: number;
	overage: number;
	overageAllowed: boolean;
	overageEnabled: boolean;
	resets: string | null;
};

/** Customer-level runtime settings for a metered entitlement. */
export type UsageSettings = {
	overageEnabled: boolean;
};

/** Effective limit state for a numeric entitlement. */
export type LimitBalance = {
	limit: number;
	included: number;
	purchased: number;
	expansionAllowed: boolean;
	autoExpansionEnabled: boolean;
};

/** Customer-level runtime settings for a numeric limit entitlement. */
export type LimitSettings = {
	purchased?: number;
	autoExpansionEnabled?: boolean;
};

/** Webhook endpoint registration request sent to the Guapocado API. */
export type WebhookRegistrationInput = {
	url: string;
	events?: "*" | string[];
	description?: string;
	integration?: string;
	registrationKey?: string;
};

/** Webhook endpoint registration result, including the receiver signing secret. */
export type WebhookRegistration = {
	id: string;
	status: "active" | "pending_approval";
	url: string;
	events: "*" | string[];
	signingSecret: string;
};

/** A per-customer enterprise/custom deal: same entitlement keys, negotiated values. */
export type CustomerContract = {
	id: string;
	customerId: string;
	priceAmount: number | null;
	priceCurrency: string;
	priceInterval: "month" | "year" | null;
	entitlements: Record<string, unknown>;
	basePlanKey: string | null;
	committedVolume: number | null;
	billingContactEmail: string | null;
	invoiceTerms: string | null;
	status: "draft" | "active" | "expired";
	startsAt: string | null;
	endsAt: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Input for creating or updating a customer's enterprise deal. */
export type CustomerContractInput = {
	priceAmount?: number | null;
	priceCurrency?: string;
	priceInterval?: "month" | "year" | null;
	entitlements?: Record<string, unknown>;
	basePlanKey?: string | null;
	committedVolume?: number | null;
	billingContactEmail?: string | null;
	invoiceTerms?: string | null;
	status?: "draft" | "active" | "expired";
	startsAt?: string | null;
	endsAt?: string | null;
	notes?: string | null;
};

/** A single append-only audit log entry. */
export type AuditLogEntry = {
	id: string;
	action: string;
	actorType: string;
	actorId: string | null;
	actorLabel: string | null;
	keyType: string | null;
	mode: string | null;
	resourceType: string | null;
	resourceId: string | null;
	requestId: string | null;
	metadata: unknown;
	createdAt: string;
};

/** Filters for listing audit log entries. */
export type AuditListFilter = {
	action?: string;
	resourceType?: string;
	resourceId?: string;
	actorId?: string;
	cursor?: string;
	limit?: number;
};

/** A page of audit log entries. */
export type AuditListResult = {
	logs: AuditLogEntry[];
	hasMore: boolean;
	nextCursor?: string;
};

/** Mutating and read-only usage operations for metered entitlements. */
export type UsageClient = {
	balance(key: string, options?: CustomerScopedOptions): Promise<UsageBalance>;
	consume(key: string, amount: number, options?: ConsumeOptions): Promise<UsageBalance>;
	configure(
		key: string,
		settings: UsageSettings,
		options?: CustomerScopedOptions,
	): Promise<UsageBalance>;
	refund(key: string, amount: number, options?: CustomerScopedOptions): Promise<UsageBalance>;
};

/** Usage operations exposed by read-only client keys. */
export type ReadOnlyUsageClient = Pick<UsageClient, "balance">;

/** Read-only client surface safe for browser/client API keys. */
export type ReadOnlyBillingClient = {
	has(key: string, options?: CustomerScopedOptions): Promise<boolean>;
	limit(key: string, options?: CustomerScopedOptions): Promise<LimitBalance>;
	usage: ReadOnlyUsageClient;
};

/** Read-only client surface safe for browser/client API keys. */
export type ReadOnlyGuapocadoClient = ReadOnlyBillingClient;

/** Full server-side Guapocado SDK client. */
export type BillingClient = ReadOnlyBillingClient & {
	usage: UsageClient;
	limits: {
		configure(
			key: string,
			settings: LimitSettings,
			options?: CustomerScopedOptions,
		): Promise<LimitBalance>;
	};
	customers: {
		create(customer?: CustomerInput): Promise<Customer>;
	};
	context(input: BillingContextInput): Promise<BillingContext>;
	plans: {
		list(): Promise<Product[]>;
	};
	purchases: {
		list(options?: CustomerScopedOptions): Promise<Purchase[]>;
	};
	subscription: {
		current(options?: CustomerScopedOptions): Promise<Subscription | null>;
		change(planKey: string, options?: CustomerScopedOptions): Promise<SubscriptionChange>;
	};
	checkout: {
		create(session: {
			productKey?: string;
			/** @deprecated Use productKey. */
			planKey?: string;
			successUrl: string;
			cancelUrl: string;
			customerId?: string;
		}): Promise<{ url: string }>;
	};
	webhooks: {
		register(endpoint: WebhookRegistrationInput): Promise<WebhookRegistration>;
	};
	/** Per-customer enterprise/custom deals (custom price + negotiated entitlement values). */
	contracts: {
		get(options?: CustomerScopedOptions): Promise<CustomerContract | null>;
		set(input: CustomerContractInput, options?: CustomerScopedOptions): Promise<CustomerContract>;
		delete(options?: CustomerScopedOptions): Promise<{ deleted: boolean }>;
	};
	/** Append-only audit trail of mutating actions, attributed to the calling token. */
	audit: {
		list(filter?: AuditListFilter): Promise<AuditListResult>;
	};
};

/** Full server-side Guapocado SDK client. */
export type GuapocadoClient = BillingClient;

/**
 * Base error thrown for any non-successful Guapocado API response. Carries the
 * HTTP `status` code and the `x-request-id` header value (as `requestId`) so
 * failures can be logged and correlated with platform-side request traces.
 *
 * @example
 * ```typescript
 * import { createGuapocadoClient, GuapocadoError } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClient({ apiKey: process.env.GUAPOCADO_API_KEY! });
 * try {
 * 	await guap.has("advanced-analytics", { customerId: "org_123" });
 * } catch (error) {
 * 	if (error instanceof GuapocadoError) {
 * 		console.error(`Guapocado request failed (${error.status})`, error.requestId);
 * 	}
 * 	throw error;
 * }
 * ```
 */
export class GuapocadoError extends Error {
	readonly status: number;
	readonly requestId?: string;

	constructor(message: string, status: number, requestId?: string) {
		super(message);
		this.name = "GuapocadoError";
		this.status = status;
		this.requestId = requestId;
	}
}

/**
 * Error thrown when an API key is invalid, missing, or revoked. Corresponds to
 * an HTTP 401 response from the Guapocado API; treat it as a configuration
 * problem rather than a retryable failure.
 *
 * @example
 * ```typescript
 * import { createGuapocadoClient, GuapocadoAuthError } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClient({ apiKey: "sk_guap_test_bad" });
 * try {
 * 	await guap.has("advanced-analytics", { customerId: "org_123" });
 * } catch (error) {
 * 	if (error instanceof GuapocadoAuthError) {
 * 		console.error("Check your GUAPOCADO_API_KEY", error.requestId);
 * 	}
 * }
 * ```
 */
export class GuapocadoAuthError extends GuapocadoError {
	constructor(message: string, requestId?: string) {
		super(message, 401, requestId);
		this.name = "GuapocadoAuthError";
	}
}

/**
 * Error thrown when the platform asks the caller to retry later, corresponding
 * to an HTTP 429 response. When the API supplies a `Retry-After` header its
 * value (in seconds) is exposed as `retryAfter` so callers can back off before
 * retrying the request.
 *
 * @example
 * ```typescript
 * import { createGuapocadoClient, GuapocadoRateLimitError } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClient({ apiKey: process.env.GUAPOCADO_API_KEY! });
 * try {
 * 	await guap.usage.consume("api-calls", 1, { customerId: "org_123" });
 * } catch (error) {
 * 	if (error instanceof GuapocadoRateLimitError) {
 * 		const waitMs = (error.retryAfter ?? 1) * 1000;
 * 		await new Promise((resolve) => setTimeout(resolve, waitMs));
 * 	}
 * }
 * ```
 */
export class GuapocadoRateLimitError extends GuapocadoError {
	readonly retryAfter?: number;

	constructor(message: string, requestId?: string, retryAfter?: number) {
		super(message, 429, requestId);
		this.name = "GuapocadoRateLimitError";
		this.retryAfter = retryAfter;
	}
}

/**
 * Error thrown when SDK input validation fails, either locally before a request
 * is sent (for example a missing `apiKey`, empty entitlement key, or
 * non-positive amount) or when the API rejects the input with an HTTP 400. The
 * `status` field is always `400`.
 *
 * @example
 * ```typescript
 * import { createGuapocadoClient, GuapocadoValidationError } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClient({ apiKey: process.env.GUAPOCADO_API_KEY! });
 * try {
 * 	await guap.usage.consume("api-calls", 0, { customerId: "org_123" });
 * } catch (error) {
 * 	if (error instanceof GuapocadoValidationError) {
 * 		console.error("Invalid usage amount:", error.message);
 * 	}
 * }
 * ```
 */
export class GuapocadoValidationError extends GuapocadoError {
	constructor(message: string, requestId?: string) {
		super(message, 400, requestId);
		this.name = "GuapocadoValidationError";
	}
}

function assertNonEmpty(value: string, name: string): void {
	if (!value || value.trim().length === 0) {
		throw new GuapocadoValidationError(`${name} must be a non-empty string`);
	}
}

function resolveCustomerId(
	defaultCustomerId: string | undefined,
	override: string | undefined,
): string {
	const customerId = override ?? defaultCustomerId;
	assertNonEmpty(customerId ?? "", "customerId");
	return customerId as string;
}

function withCustomerId(path: string, customerId: string): string {
	const sep = path.includes("?") ? "&" : "?";
	return `${path}${sep}customerId=${encodeURIComponent(customerId)}`;
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new GuapocadoValidationError(`${name} must be a positive integer`);
	}
}

function assertNonNegativeNumber(value: number, name: string): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new GuapocadoValidationError(`${name} must be a non-negative number`);
	}
}

function makeRequest(baseUrl: string, apiKey: string) {
	return async function request<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(`${baseUrl}${path}`, {
			...init,
			headers: {
				"x-guapocado-key": apiKey,
				"content-type": "application/json",
				...init?.headers,
			},
		});

		if (!res.ok) {
			const requestId = res.headers.get("x-request-id") ?? undefined;
			let message: string;
			try {
				const body = (await res.json()) as { error?: string };
				message = body.error ?? res.statusText;
			} catch {
				message = res.statusText;
			}

			if (res.status === 401) throw new GuapocadoAuthError(message, requestId);
			if (res.status === 429) {
				const retryAfter = Number(res.headers.get("retry-after")) || undefined;
				throw new GuapocadoRateLimitError(message, requestId, retryAfter);
			}
			throw new GuapocadoError(message, res.status, requestId);
		}

		return res.json() as Promise<T>;
	};
}

const GUAPOCADO_API_BASE_URL = "https://api.guapocado.dev";

async function readFromModel<T>(
	readModel: GuapocadoReadModel | undefined,
	operation: GuapocadoReadModelOperation,
	read: (() => Promise<GuapocadoReadModelResult<T>> | undefined) | undefined,
): Promise<T | undefined> {
	if (!read) return undefined;
	try {
		const result = await read();
		if (!result) return undefined;
		return result.found ? result.value : undefined;
	} catch (error) {
		readModel?.onError?.(error, { operation, phase: "read" });
		return undefined;
	}
}

async function trueUpReadModel(
	readModel: GuapocadoReadModel | undefined,
	event: GuapocadoReadModelTrueUpEvent,
): Promise<void> {
	if (!readModel?.trueUp) return;
	try {
		await readModel.trueUp(event);
	} catch (error) {
		readModel.onError?.(error, { operation: event.operation, phase: "trueUp" });
	}
}

/**
 * Creates the full server-side Guapocado client exposing entitlement checks,
 * usage reads and writes, limit configuration, customer sync, checkout,
 * subscription changes, contracts, audit logs, and webhook registration. The
 * returned client requires a secret (`sk_guap_...`) key and should only run on
 * a trusted server. When an `adapter` is supplied, read methods consult the
 * local read model first and fall back to the API.
 *
 * @param options - Client configuration: the secret `apiKey`, an optional
 *   default `customerId` (overridable per call), an optional `apiUrl` base URL
 *   override, and an optional local read-model `adapter`.
 * @returns A configured {@link GuapocadoClient} for billing reads and writes.
 * @example
 * ```typescript
 * import { createGuapocadoClient } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClient({
 * 	apiKey: process.env.GUAPOCADO_API_KEY!,
 * 	customerId: "org_123",
 * });
 *
 * if (await guap.has("advanced-analytics")) {
 * 	await guap.usage.consume("api-calls", 1);
 * }
 * ```
 */
export function createGuapocadoClient(options: GuapocadoClientOptions): GuapocadoClient {
	if (!options.apiKey) throw new GuapocadoValidationError("apiKey is required");
	const request = makeRequest(options.apiUrl ?? GUAPOCADO_API_BASE_URL, options.apiKey);
	const readModel = options.adapter ?? options.readModel;

	return {
		has: async (key, scopedOptions) => {
			assertNonEmpty(key, "entitlement key");
			const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
			const localValue = await readFromModel(readModel, "has", () =>
				readModel?.has?.({ customerId, key }),
			);
			if (localValue !== undefined) return localValue;
			const value = await request<boolean>(
				withCustomerId(`/v1/entitlements/${encodeURIComponent(key)}/has`, customerId),
			);
			await trueUpReadModel(readModel, { operation: "has", customerId, key, value });
			return value;
		},
		limit: async (key, scopedOptions) => {
			assertNonEmpty(key, "entitlement key");
			const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
			const localValue = await readFromModel(readModel, "limit", () =>
				readModel?.limit?.({ customerId, key }),
			);
			if (localValue !== undefined) return localValue;
			const value = await request<LimitBalance>(
				withCustomerId(`/v1/entitlements/${encodeURIComponent(key)}/limit`, customerId),
			);
			await trueUpReadModel(readModel, { operation: "limit", customerId, key, value });
			return value;
		},
		usage: {
			balance: async (key, scopedOptions) => {
				assertNonEmpty(key, "usage key");
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				const localValue = await readFromModel(readModel, "usage.balance", () =>
					readModel?.usageBalance?.({ customerId, key }),
				);
				if (localValue !== undefined) return localValue;
				const value = await request<UsageBalance>(
					withCustomerId(`/v1/usage/${encodeURIComponent(key)}/balance`, customerId),
				);
				await trueUpReadModel(readModel, { operation: "usage.balance", customerId, key, value });
				return value;
			},
			consume: (key, amount, scopedOptions) => {
				assertNonEmpty(key, "usage key");
				assertPositiveInteger(amount, "amount");
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<UsageBalance>(`/v1/usage/${encodeURIComponent(key)}/consume`, {
					method: "POST",
					body: JSON.stringify({
						customerId,
						amount,
						...(scopedOptions?.idempotencyKey
							? { idempotencyKey: scopedOptions.idempotencyKey }
							: {}),
					}),
				});
			},
			configure: (key, settings, scopedOptions) => {
				assertNonEmpty(key, "usage key");
				if (typeof settings.overageEnabled !== "boolean") {
					throw new GuapocadoValidationError("overageEnabled must be a boolean");
				}
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<UsageBalance>(`/v1/usage/${encodeURIComponent(key)}/settings`, {
					method: "POST",
					body: JSON.stringify({ customerId, ...settings }),
				});
			},
			refund: (key, amount, scopedOptions) => {
				assertNonEmpty(key, "usage key");
				assertPositiveInteger(amount, "amount");
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<UsageBalance>(`/v1/usage/${encodeURIComponent(key)}/refund`, {
					method: "POST",
					body: JSON.stringify({ customerId, amount }),
				});
			},
		},
		limits: {
			configure: (key, settings, scopedOptions) => {
				assertNonEmpty(key, "entitlement key");
				if (settings.purchased !== undefined) {
					assertNonNegativeNumber(settings.purchased, "purchased");
				}
				if (
					settings.autoExpansionEnabled !== undefined &&
					typeof settings.autoExpansionEnabled !== "boolean"
				) {
					throw new GuapocadoValidationError("autoExpansionEnabled must be a boolean");
				}
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<LimitBalance>(`/v1/entitlements/${encodeURIComponent(key)}/limit/settings`, {
					method: "POST",
					body: JSON.stringify({ customerId, ...settings }),
				});
			},
		},
		customers: {
			create: (customer = {}) =>
				request<Customer>("/v1/customers", {
					method: "POST",
					body: JSON.stringify(customer),
				}),
		},
		context: async (input) => {
			const customerId = resolveCustomerId(options.customerId, input.customerId);
			const localInput = { ...input, customerId };
			const localValue = await readFromModel(readModel, "context", () =>
				readModel?.context?.(localInput),
			);
			if (localValue !== undefined) return localValue;
			const value = await request<BillingContext>("/v1/context", {
				method: "POST",
				body: JSON.stringify({
					customer: { ...input.customer, id: customerId },
					features: input.features ?? [],
					usage: input.usage ?? [],
					limits: input.limits ?? [],
					includePlans: input.includePlans ?? true,
					includeSubscription: input.includeSubscription ?? true,
				}),
			});
			await trueUpReadModel(readModel, { operation: "context", input: localInput, value });
			return value;
		},
		plans: {
			list: async () => {
				const localValue = await readFromModel(readModel, "plans.list", () => readModel?.plans?.());
				if (localValue !== undefined) return localValue;
				const response = await request<{ plans: Product[] }>("/v1/plans");
				await trueUpReadModel(readModel, { operation: "plans.list", value: response.plans });
				return response.plans;
			},
		},
		purchases: {
			list: async (scopedOptions) => {
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				const localValue = await readFromModel(readModel, "purchases.list", () =>
					readModel?.purchases?.({ customerId }),
				);
				if (localValue !== undefined) return localValue;
				const response = await request<{ purchases: Purchase[] }>(
					withCustomerId("/v1/purchases?limit=100", customerId),
				);
				await trueUpReadModel(readModel, {
					operation: "purchases.list",
					customerId,
					value: response.purchases,
				});
				return response.purchases;
			},
		},
		subscription: {
			current: async (scopedOptions) => {
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				const localValue = await readFromModel(readModel, "subscription.current", () =>
					readModel?.currentSubscription?.({ customerId }),
				);
				if (localValue !== undefined) return localValue;
				const response = await request<{ subscriptions: Subscription[] }>(
					withCustomerId("/v1/subscriptions?limit=10", customerId),
				);
				const value =
					response.subscriptions.find((subscription) =>
						["active", "trialing", "past_due", "incomplete"].includes(subscription.status),
					) ??
					response.subscriptions[0] ??
					null;
				await trueUpReadModel(readModel, {
					operation: "subscription.current",
					customerId,
					value,
				});
				return value;
			},
			change: (planKey, scopedOptions) => {
				assertNonEmpty(planKey, "planKey");
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<SubscriptionChange>("/v1/subscriptions/change", {
					method: "POST",
					body: JSON.stringify({ customerId, planKey }),
				});
			},
		},
		checkout: {
			create: (session) => {
				const productKey = session.productKey ?? session.planKey;
				assertNonEmpty(productKey ?? "", "productKey");
				assertNonEmpty(session.successUrl, "successUrl");
				assertNonEmpty(session.cancelUrl, "cancelUrl");
				const customerId = session.customerId ?? options.customerId;
				return request<{ url: string }>("/v1/checkout", {
					method: "POST",
					body: JSON.stringify({ ...session, productKey, customerId }),
				});
			},
		},
		webhooks: {
			register: (endpoint) => {
				assertNonEmpty(endpoint.url, "webhook url");
				return request<WebhookRegistration>("/v1/webhook-endpoints/register", {
					method: "POST",
					body: JSON.stringify(endpoint),
				});
			},
		},
		contracts: {
			get: async (scopedOptions) => {
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				try {
					const response = await request<{ contract: CustomerContract }>(
						`/v1/contracts/${encodeURIComponent(customerId)}`,
					);
					return response.contract;
				} catch (error) {
					if (error instanceof GuapocadoError && error.status === 404) return null;
					throw error;
				}
			},
			set: async (input, scopedOptions) => {
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				const response = await request<{ contract: CustomerContract }>(
					`/v1/contracts/${encodeURIComponent(customerId)}`,
					{ method: "PUT", body: JSON.stringify(input) },
				);
				return response.contract;
			},
			delete: (scopedOptions) => {
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				return request<{ deleted: boolean }>(`/v1/contracts/${encodeURIComponent(customerId)}`, {
					method: "DELETE",
				});
			},
		},
		audit: {
			list: (filter) => {
				const params = new URLSearchParams();
				if (filter?.action) params.set("action", filter.action);
				if (filter?.resourceType) params.set("resourceType", filter.resourceType);
				if (filter?.resourceId) params.set("resourceId", filter.resourceId);
				if (filter?.actorId) params.set("actorId", filter.actorId);
				if (filter?.cursor) params.set("cursor", filter.cursor);
				if (filter?.limit) params.set("limit", String(filter.limit));
				const query = params.toString();
				return request<AuditListResult>(`/v1/audit${query ? `?${query}` : ""}`);
			},
		},
	};
}

/**
 * Backward-compatible alias of {@link createGuapocadoClient} that returns the
 * full server-side client. Prefer the `createGuapocadoClient` name in new code.
 *
 * @deprecated Use createGuapocadoClient.
 */
export const createBillingClient = createGuapocadoClient;

/**
 * Creates a read-only Guapocado client exposing only the safe lookup surface:
 * entitlement checks (`has`), effective limits (`limit`), and usage balances
 * (`usage.balance`). It performs no writes, so it is appropriate for browser or
 * client API keys where mutating operations must not be reachable. Like the
 * full client, reads consult a configured `adapter` before the API.
 *
 * @param options - Client configuration: the publishable/read `apiKey`, an
 *   optional default `customerId`, an optional `apiUrl` base URL override, and
 *   an optional local read-model `adapter`.
 * @returns A {@link ReadOnlyGuapocadoClient} limited to entitlement, limit, and
 *   usage-balance reads.
 * @example
 * ```typescript
 * import { createReadOnlyGuapocadoClient } from "@guapocado/sdk";
 *
 * const guap = createReadOnlyGuapocadoClient({
 * 	apiKey: process.env.GUAPOCADO_PUBLIC_KEY!,
 * 	customerId: "org_123",
 * });
 *
 * const canExport = await guap.has("csv-export");
 * const { balance } = await guap.usage.balance("api-calls");
 * ```
 */
export function createReadOnlyGuapocadoClient(
	options: GuapocadoClientOptions,
): ReadOnlyGuapocadoClient {
	if (!options.apiKey) throw new GuapocadoValidationError("apiKey is required");
	const request = makeRequest(options.apiUrl ?? GUAPOCADO_API_BASE_URL, options.apiKey);
	const readModel = options.adapter ?? options.readModel;

	return {
		has: async (key, scopedOptions) => {
			assertNonEmpty(key, "entitlement key");
			const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
			const localValue = await readFromModel(readModel, "has", () =>
				readModel?.has?.({ customerId, key }),
			);
			if (localValue !== undefined) return localValue;
			const value = await request<boolean>(
				withCustomerId(`/v1/entitlements/${encodeURIComponent(key)}/has`, customerId),
			);
			await trueUpReadModel(readModel, { operation: "has", customerId, key, value });
			return value;
		},
		limit: async (key, scopedOptions) => {
			assertNonEmpty(key, "entitlement key");
			const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
			const localValue = await readFromModel(readModel, "limit", () =>
				readModel?.limit?.({ customerId, key }),
			);
			if (localValue !== undefined) return localValue;
			const value = await request<LimitBalance>(
				withCustomerId(`/v1/entitlements/${encodeURIComponent(key)}/limit`, customerId),
			);
			await trueUpReadModel(readModel, { operation: "limit", customerId, key, value });
			return value;
		},
		usage: {
			balance: async (key, scopedOptions) => {
				assertNonEmpty(key, "usage key");
				const customerId = resolveCustomerId(options.customerId, scopedOptions?.customerId);
				const localValue = await readFromModel(readModel, "usage.balance", () =>
					readModel?.usageBalance?.({ customerId, key }),
				);
				if (localValue !== undefined) return localValue;
				const value = await request<UsageBalance>(
					withCustomerId(`/v1/usage/${encodeURIComponent(key)}/balance`, customerId),
				);
				await trueUpReadModel(readModel, { operation: "usage.balance", customerId, key, value });
				return value;
			},
		},
	};
}

/**
 * Backward-compatible alias of {@link createReadOnlyGuapocadoClient} that
 * returns the browser-safe read-only client. Prefer the
 * `createReadOnlyGuapocadoClient` name in new code.
 *
 * @deprecated Use createReadOnlyGuapocadoClient.
 */
export const createReadOnlyClient = createReadOnlyGuapocadoClient;
