import type {
	CustomerScopedOptions,
	GuapocadoClientOptions,
	LimitBalance,
	ReadOnlyGuapocadoClient,
	UsageBalance,
} from "@guapocado/sdk";
import { createReadOnlyGuapocadoClient } from "@guapocado/sdk";
import {
	type ComponentType,
	type PropsWithChildren,
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export {
	billingConfigSchema,
	createBillingClient,
	createGuapocadoClient,
	createReadOnlyGuapocadoClient,
	createReadOnlyClient,
	defineBilling,
	GUAPOCADO_DOMAIN_EVENTS,
} from "@guapocado/sdk";
export type {
	BillingClient,
	BillingClientOptions,
	BillingConfig,
	CustomerScopedOptions,
	GuapocadoClient,
	GuapocadoClientOptions,
	GuapocadoDomainEventType,
	LimitBalance,
	Product,
	ProductConfig,
	ProductPricing,
	Purchase,
	PurchaseStatus,
	ReadOnlyBillingClient,
	ReadOnlyGuapocadoClient,
	UsageBalance,
} from "@guapocado/sdk";

/**
 * Props accepted by {@link GuapocadoProvider}, allowing callers to either pass
 * a pre-built read-only client or the credentials needed to construct one.
 */
export type GuapocadoProviderProps = PropsWithChildren<
	{
		client?: ReadOnlyGuapocadoClient;
	} & Partial<GuapocadoClientOptions>
>;

/**
 * Props injected into a wrapped component by the {@link withGuapocado}
 * higher-order component, exposing the read-only client as a `guap` prop.
 */
export type WithGuapocadoProps = {
	guap: ReadOnlyGuapocadoClient;
};

/**
 * Deprecated alias for {@link GuapocadoProviderProps} kept for backwards
 * compatibility with the older billing-prefixed naming.
 *
 * @deprecated Use GuapocadoProviderProps.
 */
export type BillingProviderProps = GuapocadoProviderProps;

/**
 * Deprecated props shape that injects the read-only client under a
 * `billingClient` key, retained for backwards compatibility.
 *
 * @deprecated Use WithGuapocadoProps.
 */
export type WithBillingProps = {
	billingClient: ReadOnlyGuapocadoClient;
};

const GuapocadoContext = createContext<ReadOnlyGuapocadoClient | null>(null);

/**
 * Provides a read-only Guapocado client to all React descendants via context,
 * either reusing a supplied client or building one from an API key.
 *
 * @param props - Provider props supplying either a `client` or an `apiKey`
 *   (with optional `customerId`), plus the `children` to render.
 * @returns A context provider element wrapping the given children.
 * @example
 * ```tsx
 * <GuapocadoProvider apiKey="guap_pub_123" customerId="cus_42">
 *   <App />
 * </GuapocadoProvider>
 * ```
 */
export function GuapocadoProvider({
	apiKey,
	children,
	client,
	customerId,
}: GuapocadoProviderProps) {
	const guap = useMemo(() => {
		if (client) return client;
		if (!apiKey) {
			throw new Error("GuapocadoProvider requires either a client or an apiKey.");
		}
		return createReadOnlyGuapocadoClient({ apiKey, customerId });
	}, [apiKey, client, customerId]);

	return createElement(GuapocadoContext.Provider, { value: guap }, children);
}

/**
 * Deprecated alias for {@link GuapocadoProvider} retained so existing billing
 * provider call sites keep working without changes.
 *
 * @deprecated Use GuapocadoProvider.
 */
export const BillingProvider = GuapocadoProvider;

/**
 * Returns the read-only Guapocado client from the nearest provider in React
 * context, throwing if no provider is present.
 *
 * @returns The read-only Guapocado client supplied by {@link GuapocadoProvider}.
 * @example
 * ```tsx
 * function Status() {
 *   const guap = useGuapocado();
 *   return <span>{guap.customerId}</span>;
 * }
 * ```
 */
export function useGuapocado(): ReadOnlyGuapocadoClient {
	const guap = useContext(GuapocadoContext);
	if (!guap) {
		throw new Error("useGuapocado must be used inside a GuapocadoProvider.");
	}
	return guap;
}

/**
 * Deprecated alias for {@link useGuapocado} kept for backwards compatibility
 * with the older billing-prefixed hook name.
 *
 * @deprecated Use useGuapocado.
 */
export const useBilling = useGuapocado;

/**
 * Returns the read-only Guapocado client from React context, an explicitly
 * named alias of {@link useGuapocado} for client-focused call sites.
 */
export const useGuapocadoClient = useGuapocado;

/**
 * Deprecated alias for {@link useGuapocadoClient} retained for backwards
 * compatibility with the older billing-prefixed naming.
 *
 * @deprecated Use useGuapocadoClient.
 */
export const useBillingClient = useGuapocado;

/**
 * Higher-order component that injects the read-only Guapocado client from
 * context into the wrapped component as a `guap` prop.
 *
 * @param Component - The component to wrap; it receives the client as `guap`.
 * @example
 * ```tsx
 * type Props = WithGuapocadoProps & { label: string };
 * const Panel = withGuapocado(({ guap, label }: Props) => (
 *   <button>{label}: {guap.customerId}</button>
 * ));
 * // Rendered without the `guap` prop, which is supplied automatically:
 * <Panel label="Account" />;
 * ```
 */
export function withGuapocado<P extends WithGuapocadoProps>(Component: ComponentType<P>) {
	function WithGuapocado(props: Omit<P, keyof WithGuapocadoProps>) {
		const guap = useGuapocado();
		return createElement(Component, { ...(props as P), guap });
	}

	WithGuapocado.displayName = `withGuapocado(${
		Component.displayName ?? Component.name ?? "Component"
	})`;

	return WithGuapocado;
}

/**
 * Deprecated higher-order component that injects the read-only client into the
 * wrapped component under a `billingClient` prop.
 *
 * @param Component - The component to wrap; it receives the client as `billingClient`.
 * @deprecated Use withGuapocado.
 * @example
 * ```tsx
 * type Props = WithBillingProps & { label: string };
 * const Panel = withBilling(({ billingClient, label }: Props) => (
 *   <span>{label}: {billingClient.customerId}</span>
 * ));
 * ```
 */
export function withBilling<P extends WithBillingProps>(Component: ComponentType<P>) {
	function WithBilling(props: Omit<P, keyof WithBillingProps>) {
		const billingClient = useGuapocado();
		return createElement(Component, { ...(props as P), billingClient });
	}

	WithBilling.displayName = `withBilling(${
		Component.displayName ?? Component.name ?? "Component"
	})`;

	return WithBilling;
}

/**
 * Checks whether the current customer has a boolean feature entitlement,
 * exposing the result alongside loading, error, and refetch state.
 *
 * @param key - The entitlement (feature) key to check, e.g. `"pro_dashboard"`.
 * @param options - Optional scope overrides such as a specific `customerId`.
 * @example
 * ```tsx
 * function ProGate() {
 *   const { has, loading } = useEntitlement("pro_dashboard");
 *   if (loading) return <Spinner />;
 *   return has ? <ProDashboard /> : <UpgradePrompt />;
 * }
 * ```
 */
export function useEntitlement(key: string, options?: CustomerScopedOptions) {
	const guap = useGuapocado();
	const customerId = options?.customerId;
	const [has, setHas] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<unknown>(null);

	const refetch = useCallback(() => {
		setLoading(true);
		setError(null);
		return guap
			.has(key, { customerId })
			.then((result) => {
				setHas(result);
				return result;
			})
			.catch((err: unknown) => {
				setHas(false);
				setError(err);
				return false;
			})
			.finally(() => setLoading(false));
	}, [customerId, guap, key]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	return { error, has, loading, refetch };
}

/**
 * Reads the metered usage balance for a key (included, consumed, overage, and
 * reset date), exposing it with loading, error, and refetch state.
 *
 * @param key - The metered feature key whose balance to read, e.g. `"api_calls"`.
 * @param options - Optional scope overrides such as a specific `customerId`.
 * @example
 * ```tsx
 * function UsageMeter() {
 *   const { balance, usage, loading } = useUsageBalance("api_calls");
 *   if (loading) return <Skeleton />;
 *   return <p>{balance} of {usage?.included} remaining</p>;
 * }
 * ```
 */
export function useUsageBalance(key: string, options?: CustomerScopedOptions) {
	const guap = useGuapocado();
	const customerId = options?.customerId;
	const [usage, setUsage] = useState<UsageBalance | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<unknown>(null);

	const refetch = useCallback(() => {
		setLoading(true);
		setError(null);
		return guap.usage
			.balance(key, { customerId })
			.then((result) => {
				setUsage(result);
				return result;
			})
			.catch((err: unknown) => {
				const fallback = {
					balance: 0,
					included: 0,
					consumed: 0,
					overage: 0,
					overageAllowed: false,
					overageEnabled: false,
					resets: null,
				};
				setUsage(fallback);
				setError(err);
				return fallback;
			})
			.finally(() => setLoading(false));
	}, [customerId, guap, key]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	return {
		balance: usage?.balance ?? null,
		error,
		loading,
		refetch,
		resets: usage?.resets ?? null,
		usage,
	};
}

/**
 * Reads the effective numeric limit for a key (included plus purchased
 * capacity), exposing it with loading, error, and refetch state.
 *
 * @param key - The limit key whose effective value to read, e.g. `"seats"`.
 * @param options - Optional scope overrides such as a specific `customerId`.
 * @example
 * ```tsx
 * function SeatCounter() {
 *   const { limit, loading } = useLimit("seats");
 *   if (loading) return <Skeleton />;
 *   return <p>{limit} seats available</p>;
 * }
 * ```
 */
export function useLimit(key: string, options?: CustomerScopedOptions) {
	const guap = useGuapocado();
	const customerId = options?.customerId;
	const [limitState, setLimitState] = useState<LimitBalance | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<unknown>(null);

	const refetch = useCallback(() => {
		setLoading(true);
		setError(null);
		return guap
			.limit(key, { customerId })
			.then((result) => {
				setLimitState(result);
				return result;
			})
			.catch((err: unknown) => {
				const fallback = {
					limit: 0,
					included: 0,
					purchased: 0,
					expansionAllowed: false,
					autoExpansionEnabled: false,
				};
				setLimitState(fallback);
				setError(err);
				return fallback;
			})
			.finally(() => setLoading(false));
	}, [customerId, guap, key]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	return {
		error,
		limit: limitState?.limit ?? null,
		limitState,
		loading,
		refetch,
	};
}
