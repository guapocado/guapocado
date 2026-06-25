import type {
	BillingPlan,
	LimitBalance,
	LimitSettings,
	Subscription,
	SubscriptionChange,
	UsageBalance,
	UsageSettings,
} from "@guapocado/sdk";
import type { BetterAuthClientPlugin } from "better-auth/client";

/** Options to scope a billing call to a specific customer (defaults to the session's customer). */
export type CustomerScopedOptions = {
	customerId?: string;
};

/** The Guapocado customer resolved for the active session. */
export type GuapocadoCustomer = {
	customerId: string;
	customer?: {
		id: string;
		name?: string | null;
		email?: string | null;
	};
};

/** Result of a feature-entitlement check. */
export type GuapocadoHas = {
	customerId: string;
	allowed: boolean;
};

/** A metered entitlement's usage balance for a customer. */
export type GuapocadoUsage = { customerId: string } & UsageBalance;
/** A limit entitlement's balance for a customer. */
export type GuapocadoLimit = { customerId: string } & LimitBalance;

/** A created checkout session (the Stripe redirect URL). */
export type GuapocadoCheckout = {
	customerId: string;
	url: string;
};

/** The set of available billing plans. */
export type GuapocadoPlans = {
	plans: BillingPlan[];
};

/** A customer's current subscription, or `null` when unsubscribed. */
export type GuapocadoCurrentSubscription = {
	customerId: string;
	subscription: Subscription | null;
};

/** The result of changing a customer's subscription plan. */
export type GuapocadoChangedSubscription = {
	customerId: string;
	subscription: SubscriptionChange;
};

/** Selects which features, usage meters, limits, plans, and subscription to include in a context call. */
export type GuapocadoContextInput = CustomerScopedOptions & {
	features?: string[];
	usage?: string[];
	limits?: string[];
	includePlans?: boolean;
	includeSubscription?: boolean;
	debug?: boolean;
};

/** The full billing context for a customer: features, usage, limits, plans, and subscription. */
export type GuapocadoContext = {
	customerId: string;
	customer?: GuapocadoCustomer["customer"];
	features: Record<string, boolean>;
	usage: Record<string, UsageBalance>;
	limits: Record<string, LimitBalance>;
	plans: BillingPlan[];
	subscription: Subscription | null;
	_debug?: {
		totalMs: number;
		timings: Record<string, number>;
	};
};

/** Better Auth's `{ data, error }` envelope returned by every `authClient.guapocado.*` action. */
export type AuthClientResult<T> =
	| {
			data: T;
			error: null;
	  }
	| {
			data: null;
			error: {
				message?: string;
				status: number;
				statusText: string;
			};
	  };

/** The Better Auth client `$fetch` function passed to the plugin's actions. */
export type BetterAuthFetch = (
	path: string,
	options: {
		method: "GET" | "POST";
		body?: Record<string, unknown>;
		query?: Record<string, unknown>;
	},
) => Promise<unknown>;

function bodyWithCustomerId(
	body: Record<string, unknown>,
	options?: CustomerScopedOptions,
): Record<string, unknown> {
	return options?.customerId ? { ...body, customerId: options.customerId } : body;
}

function isAuthClientResult<T>(result: unknown): result is AuthClientResult<T> {
	return typeof result === "object" && result !== null && "data" in result && "error" in result;
}

/**
 * Creates the Better Auth client plugin that adds typed `authClient.guapocado.*`
 * actions for the browser, mirroring the server plugin's endpoints (customer,
 * context, entitlement, limit, usage, plans, subscription, and checkout).
 *
 * Every action returns Better Auth's `{ data, error }` envelope, so callers
 * handle failures without `try/catch`. Install it alongside `createAuthClient`.
 *
 * @returns A `BetterAuthClientPlugin` to pass to `createAuthClient({ plugins })`.
 * @example
 * ```typescript
 * import { guapocadoClient } from "@guapocado/better-auth/client";
 * import { createAuthClient } from "better-auth/react";
 *
 * export const authClient = createAuthClient({
 *   plugins: [guapocadoClient()],
 * });
 *
 * const { data: usage } = await authClient.guapocado.usage.consume("api-calls", 1);
 * const { data: checkout } = await authClient.guapocado.checkout.create({
 *   productKey: "pro",
 *   successUrl: `${location.origin}/billing/success`,
 *   cancelUrl: `${location.origin}/billing`,
 * });
 * ```
 */
export function guapocadoClient() {
	return {
		id: "guapocado",
		version: "0.0.2",
		pathMethods: {
			"/guapocado/customer": "POST",
			"/guapocado/context": "POST",
			"/guapocado/has": "POST",
			"/guapocado/limit": "POST",
			"/guapocado/limit/settings": "POST",
			"/guapocado/usage/balance": "POST",
			"/guapocado/usage/consume": "POST",
			"/guapocado/usage/refund": "POST",
			"/guapocado/usage/settings": "POST",
			"/guapocado/plans": "GET",
			"/guapocado/subscription": "POST",
			"/guapocado/subscription/change": "POST",
			"/guapocado/checkout": "POST",
		},
		getActions($fetch: BetterAuthFetch) {
			// Actions return Better Auth's `{ data, error }` envelope, matching the
			// rest of `authClient.*`, so callers handle errors without try/catch.
			const get = async <T>(path: string): Promise<AuthClientResult<T>> => {
				const result = await $fetch(path, { method: "GET" });
				if (isAuthClientResult<T>(result)) return result;
				return { data: result as T, error: null };
			};

			const post = async <T>(
				path: string,
				body: Record<string, unknown>,
			): Promise<AuthClientResult<T>> => {
				const result = await $fetch(path, { method: "POST", body });
				if (isAuthClientResult<T>(result)) return result;
				return { data: result as T, error: null };
			};

			return {
				guapocado: {
					customer: {
						sync: (options?: CustomerScopedOptions) =>
							post<GuapocadoCustomer>("/guapocado/customer", bodyWithCustomerId({}, options)),
					},
					context: (input: GuapocadoContextInput = {}) =>
						post<GuapocadoContext>("/guapocado/context", input),
					has: (key: string, options?: CustomerScopedOptions) =>
						post<GuapocadoHas>("/guapocado/has", bodyWithCustomerId({ key }, options)),
					limit: (key: string, options?: CustomerScopedOptions) =>
						post<GuapocadoLimit>("/guapocado/limit", bodyWithCustomerId({ key }, options)),
					plans: {
						list: () => get<GuapocadoPlans>("/guapocado/plans"),
					},
					subscription: {
						current: (options?: CustomerScopedOptions) =>
							post<GuapocadoCurrentSubscription>(
								"/guapocado/subscription",
								bodyWithCustomerId({}, options),
							),
						change: (planKey: string, options?: CustomerScopedOptions) =>
							post<GuapocadoChangedSubscription>(
								"/guapocado/subscription/change",
								bodyWithCustomerId({ planKey }, options),
							),
					},
					limits: {
						configure: (key: string, settings: LimitSettings, options?: CustomerScopedOptions) =>
							post<GuapocadoLimit>(
								"/guapocado/limit/settings",
								bodyWithCustomerId({ key, ...settings }, options),
							),
					},
					usage: {
						balance: (key: string, options?: CustomerScopedOptions) =>
							post<GuapocadoUsage>(
								"/guapocado/usage/balance",
								bodyWithCustomerId({ key }, options),
							),
						consume: (key: string, amount = 1, options?: CustomerScopedOptions) =>
							post<GuapocadoUsage>(
								"/guapocado/usage/consume",
								bodyWithCustomerId({ key, amount }, options),
							),
						refund: (key: string, amount = 1, options?: CustomerScopedOptions) =>
							post<GuapocadoUsage>(
								"/guapocado/usage/refund",
								bodyWithCustomerId({ key, amount }, options),
							),
						configure: (key: string, settings: UsageSettings, options?: CustomerScopedOptions) =>
							post<GuapocadoUsage>(
								"/guapocado/usage/settings",
								bodyWithCustomerId({ key, ...settings }, options),
							),
					},
					checkout: {
						create: (session: {
							productKey?: string;
							/** @deprecated Use productKey. */
							planKey?: string;
							successUrl: string;
							cancelUrl: string;
							customerId?: string;
						}) => post<GuapocadoCheckout>("/guapocado/checkout", session),
					},
				},
			};
		},
	} satisfies BetterAuthClientPlugin;
}
