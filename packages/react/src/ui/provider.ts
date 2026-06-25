import { type PropsWithChildren, createContext, createElement, useContext, useMemo } from "react";

/** Billing interval labels understood by Guapocado UI formatters. */
export type GuapocadoBillingInterval = "day" | "week" | "month" | "year" | (string & {});

/** Display-only plan data consumed by Guapocado UI components. */
export type GuapocadoPlanDisplayContext = {
	currency?: string | null;
	description?: string | null;
	features?: readonly string[];
	id?: string;
	interval?: GuapocadoBillingInterval | null;
	name?: string | null;
	price?: number | null;
	trialDays?: number | null;
};

/** Display-only subscription data consumed by Guapocado UI components. */
export type GuapocadoSubscriptionDisplayContext = {
	cancelAtPeriodEnd?: boolean;
	currentPeriodEnd?: Date | number | string | null;
	id?: string;
	planId?: string;
	status?: string | null;
};

/** Default text labels used by Guapocado UI components. */
export type GuapocadoUILabels = {
	cancelled: string;
	currentPlan: string;
	included: string;
	loading: string;
	managePlan: string;
	upgrade: string;
	usage: string;
	unavailable: string;
};

/** Options passed to the currency formatter. */
export type GuapocadoCurrencyFormatOptions = {
	currency?: string;
	locale?: string;
	numberFormat?: Intl.NumberFormatOptions;
};

/** Options passed to the number formatter. */
export type GuapocadoNumberFormatOptions = {
	locale?: string;
	numberFormat?: Intl.NumberFormatOptions;
};

/** Options passed to the date formatter. */
export type GuapocadoDateFormatOptions = {
	dateFormat?: Intl.DateTimeFormatOptions;
	locale?: string;
};

/** Formatter functions used by Guapocado UI components. */
export type GuapocadoUIFormatters = {
	currency: (amount: number, options?: GuapocadoCurrencyFormatOptions) => string;
	date: (value: Date | number | string, options?: GuapocadoDateFormatOptions) => string;
	number: (value: number, options?: GuapocadoNumberFormatOptions) => string;
};

/** Value exposed by the Guapocado UI context. */
export type GuapocadoUIContextValue = {
	currency: string;
	formatters: GuapocadoUIFormatters;
	labels: GuapocadoUILabels;
	locale: string;
	plan: GuapocadoPlanDisplayContext | null;
	subscription: GuapocadoSubscriptionDisplayContext | null;
};

/**
 * Props accepted by {@link GuapocadoUIProvider} for overriding the currency,
 * locale, labels, formatters, and plan/subscription display context.
 */
export type GuapocadoUIProviderProps = PropsWithChildren<{
	currency?: string;
	formatters?: Partial<GuapocadoUIFormatters>;
	labels?: Partial<GuapocadoUILabels>;
	locale?: string;
	plan?: GuapocadoPlanDisplayContext | null;
	subscription?: GuapocadoSubscriptionDisplayContext | null;
}>;

const DEFAULT_CURRENCY = "USD";
const DEFAULT_LOCALE = "en-US";

const defaultLabels: GuapocadoUILabels = {
	cancelled: "Cancelled",
	currentPlan: "Current plan",
	included: "Included",
	loading: "Loading",
	managePlan: "Manage plan",
	upgrade: "Upgrade",
	usage: "Usage",
	unavailable: "Unavailable",
};

function createDefaultFormatters(locale: string, currency: string): GuapocadoUIFormatters {
	return {
		currency(amount, options) {
			return new Intl.NumberFormat(options?.locale ?? locale, {
				currency: options?.currency ?? currency,
				style: "currency",
				...options?.numberFormat,
			}).format(amount);
		},
		date(value, options) {
			const date = value instanceof Date ? value : new Date(value);
			if (Number.isNaN(date.getTime())) return "";

			return new Intl.DateTimeFormat(options?.locale ?? locale, {
				dateStyle: "medium",
				...options?.dateFormat,
			}).format(date);
		},
		number(value, options) {
			return new Intl.NumberFormat(options?.locale ?? locale, options?.numberFormat).format(value);
		},
	};
}

const defaultContext: GuapocadoUIContextValue = {
	currency: DEFAULT_CURRENCY,
	formatters: createDefaultFormatters(DEFAULT_LOCALE, DEFAULT_CURRENCY),
	labels: defaultLabels,
	locale: DEFAULT_LOCALE,
	plan: null,
	subscription: null,
};

const GuapocadoUIContext = createContext<GuapocadoUIContextValue>(defaultContext);

/**
 * Supplies UI-only labels, formatters, currency/locale, and plan/subscription
 * display context to Guapocado UI components via React context, merging any
 * overrides over sensible defaults.
 *
 * @param props - Provider props such as `currency`, `locale`, partial `labels`
 *   and `formatters` overrides, `plan`, `subscription`, and `children`.
 * @returns A context provider element wrapping the given children.
 * @example
 * ```tsx
 * <GuapocadoUIProvider currency="EUR" locale="de-DE" labels={{ upgrade: "Upgraden" }}>
 *   <PricingTable />
 * </GuapocadoUIProvider>
 * ```
 */
export function GuapocadoUIProvider({
	children,
	currency = DEFAULT_CURRENCY,
	formatters,
	labels,
	locale = DEFAULT_LOCALE,
	plan = null,
	subscription = null,
}: GuapocadoUIProviderProps) {
	const value = useMemo<GuapocadoUIContextValue>(() => {
		const defaultFormatters = createDefaultFormatters(locale, currency);

		return {
			currency,
			formatters: {
				...defaultFormatters,
				...formatters,
			},
			labels: {
				...defaultLabels,
				...labels,
			},
			locale,
			plan,
			subscription,
		};
	}, [currency, formatters, labels, locale, plan, subscription]);

	return createElement(GuapocadoUIContext.Provider, { value }, children);
}

/**
 * Returns the current UI-only Guapocado context value, including labels,
 * formatters, currency, locale, and plan/subscription display data, falling
 * back to defaults when no provider is present.
 *
 * @returns The active {@link GuapocadoUIContextValue} from context.
 * @example
 * ```tsx
 * function Price({ amount }: { amount: number }) {
 *   const { formatters } = useGuapocadoUI();
 *   return <span>{formatters.currency(amount)}</span>;
 * }
 * ```
 */
export function useGuapocadoUI() {
	return useContext(GuapocadoUIContext);
}
