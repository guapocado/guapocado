import { z } from "zod";

/** Supported Guapocado domain snapshot event types that webhook receivers can subscribe to. */
export const GUAPOCADO_DOMAIN_EVENTS = [
	"customer.updated",
	"subscription.updated",
	"purchase.completed",
	"purchase.updated",
	"entitlements.updated",
	"invoice.updated",
	"usage.updated",
] as const;

/** Supported Guapocado domain snapshot event type. */
export type GuapocadoDomainEventType = (typeof GUAPOCADO_DOMAIN_EVENTS)[number];

/** Supported entitlement categories in a Guapocado billing config. */
export type EntitlementType = "feature" | "meter" | "limit";

/** Defines the behavior of an entitlement key before any plan-specific values are applied. */
export type EntitlementDefinition = {
	type: EntitlementType;
	reset?: "monthly" | "daily" | "weekly";
};

/** Supported recurring billing intervals for subscription pricing. */
export type BillingFrequency = "month" | "year";

/** Supported pricing shapes independent of billing mode. */
export type PricingShape = "flat" | "per_seat" | "usage";

/** Pricing metadata for a recurring subscription product billed each interval. */
export type RecurringPricingModel = {
	mode: "recurring";
	type: PricingShape;
	amount?: number;
	currency?: string;
	frequency: BillingFrequency;
	/** @deprecated Use frequency. */
	interval?: BillingFrequency;
};

/** Pricing metadata for a one-time product charged via a single payment. */
export type OneTimePricingModel = {
	mode: "one_time";
	type: PricingShape;
	amount?: number;
	currency?: string;
	frequency?: never;
	/** @deprecated One-time prices do not have an interval. */
	interval?: never;
};

/**
 * "Contact us" pricing. Custom tiers have no Stripe price: they are skipped by
 * Stripe sync and checkout is rejected for them — the tier is sold via an
 * enterprise contract instead. Surface it as a "contact sales" CTA.
 */
export type CustomPricingModel = {
	mode: "custom";
	/** Optional shape hint for display. Custom tiers have no Stripe price. */
	type?: PricingShape;
	/** Optional contact link (URL or mailto) for the "contact sales" CTA. */
	contact?: string;
	amount?: never;
	currency?: never;
	frequency?: never;
	interval?: never;
};

/** Price metadata for a product. */
export type PricingModel = RecurringPricingModel | OneTimePricingModel | CustomPricingModel;

/** Price details for optional meter overage or limit expansion. */
export type EntitlementPricing = {
	allowed: boolean;
	unit: number;
	amount: number;
	currency: string;
};

/** Plan value for a metered entitlement. */
export type MeterEntitlementValue = {
	included: number;
	overage?: EntitlementPricing;
};

/** Plan value for a numeric limit entitlement. */
export type LimitEntitlementValue = {
	included: number;
	expansion?: EntitlementPricing;
};

/** Plan-specific entitlement value for features, meters, or limits. */
export type PlanEntitlementValue = boolean | MeterEntitlementValue | LimitEntitlementValue;

/** Product or plan declaration inside a Guapocado billing config. */
export type PlanDefinition = {
	key: string;
	name?: string;
	pricing?: PricingModel;
	entitlements: Record<string, PlanEntitlementValue>;
};

/** Declarative webhook forwarding intent managed from project config. */
export type WebhookForwardingDefinition = {
	key: string;
	url?: string;
	path?: string;
	events?: "*" | string[];
	description?: string;
	integration?: "better-auth" | string;
	autoRegister?: boolean;
};

/** CLI generation defaults that can be stored in billing.config.ts. */
export type TableGenerationConfig = {
	enabled?: boolean;
	/** Table set to generate. Supported value: server. */
	tableSet?: "server" | string;
	/** ORM target for generated tables. Supported value: drizzle. */
	orm?: "drizzle" | string;
	/** Database dialect for generated tables. Supported values: sqlite, pg, mysql. */
	db?: "sqlite" | "pg" | "mysql" | string;
	output?: string;
};

/** Local code generation defaults consumed by the Guapocado CLI. */
export type GenerateConfig = {
	tables?: TableGenerationConfig;
};

/** Checkout-related project configuration, including redirect host allow-listing. */
export type CheckoutConfig = {
	/**
	 * Hostnames the checkout `successUrl`/`cancelUrl` must redirect to. When set,
	 * the API rejects redirect URLs whose host is not in this list (host-only
	 * check — path and query string are preserved). Closes open-redirect risk.
	 */
	allowedRedirectHosts?: string[];
};

/** Top-level project billing config consumed by the CLI, SDK generators, and API. */
export type BillingConfig = {
	entitlements: Record<string, EntitlementDefinition>;
	products: PlanDefinition[];
	webhooks?: {
		devTunnel?: boolean;
		forwarding?: WebhookForwardingDefinition[];
	};
	checkout?: CheckoutConfig;
	generate?: GenerateConfig;
};

const entitlementDefinitionSchema = z.object({
	type: z.enum(["feature", "meter", "limit"]),
	reset: z.enum(["monthly", "daily", "weekly"]).optional(),
});

const entitlementPricingSchema = z.object({
	allowed: z.boolean(),
	unit: z.number().positive(),
	amount: z.number().nonnegative(),
	currency: z.string().regex(/^[a-z]{3}$/),
});

const meterEntitlementValueSchema = z.object({
	included: z.number().nonnegative(),
	overage: entitlementPricingSchema.optional(),
});

const limitEntitlementValueSchema = z.object({
	included: z.number().nonnegative(),
	expansion: entitlementPricingSchema.optional(),
});

const planEntitlementValueSchema = z.union([
	z.boolean(),
	meterEntitlementValueSchema,
	limitEntitlementValueSchema,
]);

const pricingModelSchema = z
	.object({
		// Optional so `mode: "custom"` tiers (no Stripe price) can omit a shape.
		type: z.enum(["flat", "per_seat", "usage"]).optional(),
		amount: z.number().optional(),
		currency: z.string().optional(),
		mode: z.enum(["recurring", "one_time", "custom"]).optional(),
		frequency: z.enum(["month", "year"]).optional(),
		interval: z.enum(["month", "year"]).optional(),
		contact: z.string().optional(),
	})
	.superRefine((pricing, ctx) => {
		const mode = pricing.mode ?? (pricing.frequency || pricing.interval ? "recurring" : undefined);
		if (!mode) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["mode"],
				message: 'pricing.mode must be "recurring", "one_time", or "custom"',
			});
			return;
		}

		if (mode === "custom") {
			if (pricing.amount !== undefined || pricing.frequency || pricing.interval) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["mode"],
					message: "custom pricing must not include amount, frequency, or interval",
				});
			}
			return;
		}

		// Recurring and one-time tiers are sold through Stripe and need a shape.
		if (!pricing.type) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["type"],
				message: "pricing.type is required for recurring and one-time pricing",
			});
		}

		if (mode === "recurring") {
			if (!pricing.frequency && !pricing.interval) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["frequency"],
					message: "recurring pricing requires frequency",
				});
			}
			return;
		}

		if (pricing.frequency || pricing.interval) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["frequency"],
				message: "one-time pricing must not include frequency or interval",
			});
		}
	})
	.transform((pricing): PricingModel => {
		const mode =
			pricing.mode ?? (pricing.frequency || pricing.interval ? "recurring" : "recurring");
		if (mode === "custom") {
			return {
				mode: "custom",
				...(pricing.type ? { type: pricing.type } : {}),
				...(pricing.contact ? { contact: pricing.contact } : {}),
			};
		}
		if (!pricing.type) {
			throw new Error("pricing.type is required for recurring and one-time pricing");
		}
		if (mode === "recurring") {
			const frequency = pricing.frequency ?? pricing.interval;
			if (!frequency) {
				throw new Error("recurring pricing requires frequency");
			}
			return {
				type: pricing.type,
				amount: pricing.amount,
				currency: pricing.currency,
				mode,
				frequency,
				...(pricing.interval ? { interval: pricing.interval } : {}),
			};
		}
		return {
			type: pricing.type,
			amount: pricing.amount,
			currency: pricing.currency,
			mode,
		};
	});

const planDefinitionSchema = z.object({
	key: z.string().min(1),
	name: z.string().optional(),
	pricing: pricingModelSchema.optional(),
	entitlements: z.record(planEntitlementValueSchema),
});

const webhookForwardingSchema = z
	.object({
		key: z.string().min(1),
		url: z.string().url().optional(),
		path: z.string().startsWith("/").optional(),
		events: z.union([z.literal("*"), z.array(z.string().min(1))]).optional(),
		description: z.string().optional(),
		integration: z.string().optional(),
		autoRegister: z.boolean().optional(),
	})
	.refine((value) => value.url || value.path, {
		message: "Either url or path is required",
	});

const tableGenerationSchema = z.object({
	enabled: z.boolean().optional(),
	tableSet: z.string().optional(),
	orm: z.string().optional(),
	db: z.string().optional(),
	output: z.string().optional(),
});

const generateConfigSchema = z.object({
	tables: tableGenerationSchema.optional(),
});

/** Runtime Zod schema for validating Guapocado billing configs. */
export const billingConfigSchema = z.object({
	entitlements: z.record(entitlementDefinitionSchema),
	products: z.array(planDefinitionSchema),
	webhooks: z
		.object({
			devTunnel: z.boolean().optional(),
			forwarding: z.array(webhookForwardingSchema).optional(),
		})
		.optional(),
	checkout: z
		.object({
			allowedRedirectHosts: z.array(z.string().min(1)).optional(),
		})
		.optional(),
	generate: generateConfigSchema.optional(),
});

/**
 * Validates a billing config against the runtime Zod schema and returns it as a
 * fully typed {@link BillingConfig}, throwing if the config is structurally
 * invalid (e.g. a recurring product missing its frequency). This is the helper
 * users wrap their `billing.config.ts` export in for type safety and validation.
 *
 * @param config The billing config object (entitlements, products, and optional sections) to validate.
 * @returns The same config, parsed and typed as a {@link BillingConfig}.
 * @example
 * ```ts
 * import { defineBilling } from "@guapocado/shared";
 *
 * export default defineBilling({
 * 	entitlements: { "ai.summary": { type: "feature" } },
 * 	products: [{ key: "free", entitlements: { "ai.summary": false } }],
 * });
 * ```
 */
export function defineBilling(config: BillingConfig): BillingConfig {
	return billingConfigSchema.parse(config) as BillingConfig;
}

/**
 * Validates a billing config and serializes it to tab-indented canonical JSON,
 * prepending the `$schema` URL and schema `version` so the output is a complete,
 * editor-validatable billing document — used to write `billing.json` from a
 * TypeScript config.
 *
 * @param config The billing config object to validate and serialize to canonical JSON.
 * @returns A pretty-printed JSON string containing the `$schema`, `version`, and validated config fields.
 * @example
 * ```ts
 * import { defineBillingToJson } from "@guapocado/shared";
 *
 * const json = defineBillingToJson(config);
 * await writeFile("billing.json", json);
 * ```
 */
export function defineBillingToJson(config: BillingConfig): string {
	const parsed = billingConfigSchema.parse(config) as BillingConfig;
	return JSON.stringify(
		{
			$schema: "https://api.guapocado.dev/v1/schema/billing",
			version: 1,
			...parsed,
		},
		null,
		"\t",
	);
}
