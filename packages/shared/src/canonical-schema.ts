import type { BillingConfig } from "./schema.js";
import type { PlanEntitlementValue, PricingModel, WebhookForwardingDefinition } from "./schema.js";

/** Current canonical billing config schema version. */
export const BILLING_SCHEMA_VERSION = 1;

/** Language-agnostic JSON shape used for persisted and transported billing configs. */
export type CanonicalBillingConfig = {
	$schema?: string;
	version: number;
	entitlements: Record<
		string,
		{
			type: "feature" | "meter" | "limit";
			reset?: "monthly" | "daily" | "weekly";
			metadata?: Record<string, unknown>;
		}
	>;
	products: Array<{
		key: string;
		name?: string;
		pricing?: {
			mode?: "recurring" | "one_time" | "custom";
			/** Optional so `mode: "custom"` tiers (no Stripe price) can omit a shape. */
			type?: "flat" | "per_seat" | "usage";
			amount?: number;
			currency?: string;
			frequency?: "month" | "year";
			/** @deprecated Use frequency. */
			interval?: "month" | "year";
			/** Contact link for "contact sales" CTA on custom tiers. */
			contact?: string;
		};
		entitlements: Record<string, PlanEntitlementValue>;
		metadata?: Record<string, unknown>;
	}>;
	webhooks?: {
		devTunnel?: boolean;
		forwarding?: WebhookForwardingDefinition[];
	};
	checkout?: BillingConfig["checkout"];
	generate?: BillingConfig["generate"];
	metadata?: Record<string, unknown>;
};

/**
 * Converts an in-memory SDK {@link BillingConfig} into the language-agnostic
 * canonical JSON shape used for persistence and transport, stamping it with the
 * current {@link BILLING_SCHEMA_VERSION} and copying over only the optional
 * sections (webhooks, checkout, generate) that are actually present.
 *
 * @param config The SDK billing config (entitlements, products, and optional sections) to serialize.
 * @param schemaUrl Optional JSON Schema URL written to the canonical `$schema` field for editor and CLI validation.
 * @returns A {@link CanonicalBillingConfig} ready to serialize to JSON or validate.
 * @example
 * ```ts
 * import { toCanonical } from "@guapocado/shared";
 *
 * const canonical = toCanonical(config, "https://api.guapocado.dev/v1/schema/billing");
 * await writeFile("billing.json", JSON.stringify(canonical, null, 2));
 * ```
 */
export function toCanonical(config: BillingConfig, schemaUrl?: string): CanonicalBillingConfig {
	const canonical: CanonicalBillingConfig = {
		version: BILLING_SCHEMA_VERSION,
		entitlements: config.entitlements,
		products: config.products,
	};
	if (config.webhooks) {
		canonical.webhooks = config.webhooks;
	}
	if (config.checkout) {
		canonical.checkout = config.checkout;
	}
	if (config.generate) {
		canonical.generate = config.generate;
	}
	if (schemaUrl) {
		canonical.$schema = schemaUrl;
	}
	return canonical;
}

function normalizePricing(
	pricing: CanonicalBillingConfig["products"][number]["pricing"],
): PricingModel | undefined {
	if (!pricing) return undefined;
	const mode = pricing.mode ?? (pricing.frequency || pricing.interval ? "recurring" : "recurring");
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
	if (mode === "one_time") {
		return {
			mode,
			type: pricing.type,
			amount: pricing.amount,
			currency: pricing.currency,
		};
	}
	const frequency = pricing.frequency ?? pricing.interval;
	if (!frequency) {
		throw new Error("recurring pricing requires frequency");
	}
	return {
		mode: "recurring",
		type: pricing.type,
		amount: pricing.amount,
		currency: pricing.currency,
		frequency,
		...(pricing.interval ? { interval: pricing.interval } : {}),
	};
}

/**
 * Converts a canonical JSON config back into the in-memory SDK
 * {@link BillingConfig} shape, normalizing each product's pricing (resolving
 * the deprecated `interval` alias to `frequency` and validating recurring vs.
 * one-time vs. custom modes) so the result can be consumed by the SDK.
 *
 * @param canonical The canonical billing config previously produced by {@link toCanonical} or loaded from JSON.
 * @returns A {@link BillingConfig} with normalized pricing for each product.
 * @example
 * ```ts
 * import { fromCanonical } from "@guapocado/shared";
 *
 * const canonical = JSON.parse(await readFile("billing.json", "utf8"));
 * const config = fromCanonical(canonical);
 * console.log(config.products.map((p) => p.key));
 * ```
 */
export function fromCanonical(canonical: CanonicalBillingConfig): BillingConfig {
	return {
		entitlements: canonical.entitlements,
		products: canonical.products.map((product) => ({
			key: product.key,
			name: product.name,
			pricing: normalizePricing(product.pricing),
			entitlements: product.entitlements,
		})),
		webhooks: canonical.webhooks,
		checkout: canonical.checkout,
		generate: canonical.generate,
	};
}

/** JSON Schema document for editor and CLI validation of canonical billing configs. */
export const billingJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://api.guapocado.dev/v1/schema/billing",
	title: "Guapocado Billing Configuration",
	description:
		"Canonical JSON schema for Guapocado billing configurations. Language-agnostic format for defining plans, entitlements, and pricing.",
	type: "object" as const,
	required: ["version", "entitlements", "products"],
	properties: {
		$schema: {
			type: "string" as const,
			description: "JSON Schema URL for validation and IDE support",
		},
		version: {
			type: "integer" as const,
			minimum: 1,
			description: "Schema version number for forward compatibility",
		},
		entitlements: {
			type: "object" as const,
			description: "Entitlement definitions keyed by entitlement identifier",
			additionalProperties: {
				type: "object" as const,
				required: ["type"],
				properties: {
					type: {
						type: "string" as const,
						enum: ["feature", "meter", "limit"],
						description: "The type of entitlement",
					},
					reset: {
						type: "string" as const,
						enum: ["monthly", "daily", "weekly"],
						description: "Reset period for metered entitlements",
					},
					metadata: {
						type: "object" as const,
						description: "Arbitrary metadata for this entitlement",
					},
				},
			},
		},
		products: {
			type: "array" as const,
			description: "Product/plan definitions",
			items: {
				type: "object" as const,
				required: ["key", "entitlements"],
				properties: {
					key: {
						type: "string" as const,
						minLength: 1,
						description: "Unique plan identifier",
					},
					name: {
						type: "string" as const,
						description: "Human-readable plan name",
					},
					pricing: {
						type: "object" as const,
						properties: {
							mode: {
								type: "string" as const,
								enum: ["recurring", "one_time", "custom"],
								description:
									'Billing mode. Recurring products use subscription checkout; one_time products use payment checkout; custom ("contact us") tiers have no Stripe price and reject checkout.',
							},
							type: {
								type: "string" as const,
								enum: ["flat", "per_seat", "usage"],
								description:
									"Price shape. Does not determine recurring vs one-time billing. Optional for custom tiers.",
							},
							amount: {
								type: "number" as const,
								description: "Price amount in smallest currency unit",
							},
							currency: {
								type: "string" as const,
								description: "ISO 4217 currency code (lowercase)",
								pattern: "^[a-z]{3}$",
							},
							frequency: {
								type: "string" as const,
								enum: ["month", "year"],
								description: "Required for recurring pricing. Omit for one-time pricing.",
							},
							interval: {
								type: "string" as const,
								enum: ["month", "year"],
								deprecated: true,
								description: "Deprecated compatibility alias for frequency.",
							},
							contact: {
								type: "string" as const,
								description:
									'Contact link (URL or mailto) for the "contact sales" CTA on custom tiers.',
							},
						},
					},
					entitlements: {
						type: "object" as const,
						description:
							"Entitlement values for this plan. Keys must reference defined entitlements.",
						additionalProperties: {
							oneOf: [
								{ type: "boolean" as const },
								{
									type: "object" as const,
									required: ["included"],
									properties: {
										included: { type: "number" as const, minimum: 0 },
										overage: {
											type: "object" as const,
											required: ["allowed", "unit", "amount", "currency"],
											properties: {
												allowed: { type: "boolean" as const },
												unit: { type: "number" as const, exclusiveMinimum: 0 },
												amount: { type: "number" as const, minimum: 0 },
												currency: {
													type: "string" as const,
													pattern: "^[a-z]{3}$",
												},
											},
										},
										expansion: {
											type: "object" as const,
											required: ["allowed", "unit", "amount", "currency"],
											properties: {
												allowed: { type: "boolean" as const },
												unit: { type: "number" as const, exclusiveMinimum: 0 },
												amount: { type: "number" as const, minimum: 0 },
												currency: {
													type: "string" as const,
													pattern: "^[a-z]{3}$",
												},
											},
										},
									},
								},
							],
						},
					},
					metadata: {
						type: "object" as const,
						description: "Arbitrary metadata for this plan",
					},
				},
			},
		},
		webhooks: {
			type: "object" as const,
			description: "Webhook forwarding declarations managed from billing config.",
			properties: {
				devTunnel: {
					type: "boolean" as const,
					description:
						"When true, development scripts may start the Guapocado dev relay for configured webhook receivers.",
				},
				forwarding: {
					type: "array" as const,
					items: {
						type: "object" as const,
						required: ["key"],
						properties: {
							key: { type: "string" as const, minLength: 1 },
							url: {
								type: "string" as const,
								format: "uri",
								description: "Absolute endpoint URL to forward events to.",
							},
							path: {
								type: "string" as const,
								pattern: "^/",
								description: "App-relative endpoint path when the integration auto-registers.",
							},
							events: {
								oneOf: [
									{ const: "*" },
									{
										type: "array" as const,
										items: { type: "string" as const, minLength: 1 },
									},
								],
							},
							description: { type: "string" as const },
							integration: { type: "string" as const },
							autoRegister: {
								type: "boolean" as const,
								description:
									"When true, an integration library may register the receiver URL automatically instead of requiring a manually configured webhook secret.",
							},
						},
					},
				},
			},
		},
		generate: {
			type: "object" as const,
			description: "Local code generation defaults consumed by the Guapocado CLI.",
			properties: {
				tables: {
					type: "object" as const,
					description: "Database table generation defaults for server SDK storage.",
					properties: {
						enabled: {
							type: "boolean" as const,
							description: "When true, `guap generate` writes table definitions by default.",
						},
						tableSet: {
							type: "string" as const,
							description: "Table set to generate. Currently supports `server`.",
						},
						orm: {
							type: "string" as const,
							description: "ORM target. Supported value: `drizzle`.",
						},
						db: {
							type: "string" as const,
							description:
								"Database dialect for generated tables. Supported values: `sqlite`, `pg`, `mysql`.",
						},
						output: {
							type: "string" as const,
							description: "Output filename or path for generated table definitions.",
						},
					},
				},
			},
		},
		metadata: {
			type: "object" as const,
			description: "Arbitrary top-level metadata",
		},
	},
};

/**
 * Performs lightweight, dependency-free validation of an unknown value against
 * the canonical billing config shape, checking the version, entitlement types,
 * unique product keys, and pricing-mode constraints without pulling in Zod —
 * useful in CLIs and edge runtimes where the full schema is unavailable.
 *
 * @param data The untrusted value (e.g. parsed JSON) to validate as a canonical billing config.
 * @returns An object with `valid` (true when there are no errors) and `errors`, a list of human-readable validation messages.
 * @example
 * ```ts
 * import { validateCanonical } from "@guapocado/shared";
 *
 * const result = validateCanonical(JSON.parse(rawJson));
 * if (!result.valid) {
 * 	console.error(result.errors.join("\n"));
 * 	process.exit(1);
 * }
 * ```
 */
export function validateCanonical(data: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!data || typeof data !== "object") {
		return { valid: false, errors: ["Input must be an object"] };
	}
	const obj = data as Record<string, unknown>;

	if (typeof obj.version !== "number" || obj.version < 1) {
		errors.push("version must be a positive integer");
	}

	if (!obj.entitlements || typeof obj.entitlements !== "object") {
		errors.push("entitlements must be an object");
	} else {
		const ents = obj.entitlements as Record<string, unknown>;
		const validTypes = ["feature", "meter", "limit"];
		for (const [key, val] of Object.entries(ents)) {
			if (!val || typeof val !== "object") {
				errors.push(`entitlements.${key} must be an object`);
				continue;
			}
			const ent = val as Record<string, unknown>;
			if (!validTypes.includes(ent.type as string)) {
				errors.push(`entitlements.${key}.type must be one of: ${validTypes.join(", ")}`);
			}
		}
	}

	if (!Array.isArray(obj.products)) {
		errors.push("products must be an array");
	} else {
		const keys = new Set<string>();
		for (const [i, product] of (obj.products as unknown[]).entries()) {
			if (!product || typeof product !== "object") {
				errors.push(`products[${i}] must be an object`);
				continue;
			}
			const p = product as Record<string, unknown>;
			if (typeof p.key !== "string" || !p.key) {
				errors.push(`products[${i}].key must be a non-empty string`);
			} else if (keys.has(p.key)) {
				errors.push(`products[${i}].key "${p.key}" is a duplicate`);
			} else {
				keys.add(p.key);
			}
			if (!p.entitlements || typeof p.entitlements !== "object") {
				errors.push(`products[${i}].entitlements must be an object`);
			}
			if (p.pricing !== undefined) {
				if (!p.pricing || typeof p.pricing !== "object") {
					errors.push(`products[${i}].pricing must be an object`);
				} else {
					const pricing = p.pricing as Record<string, unknown>;
					const mode = pricing.mode;
					const frequency = pricing.frequency ?? pricing.interval;
					if (mode === "custom") {
						if (pricing.amount !== undefined || pricing.frequency || pricing.interval) {
							errors.push(
								`products[${i}].pricing.custom tiers must not include amount, frequency, or interval`,
							);
						}
					} else {
						if (mode !== "recurring" && mode !== "one_time" && !frequency) {
							errors.push(`products[${i}].pricing.mode must be recurring, one_time, or custom`);
						}
						if ((mode === "recurring" || (!mode && frequency)) && !frequency) {
							errors.push(`products[${i}].pricing.frequency is required for recurring pricing`);
						}
						if (mode === "one_time" && (pricing.frequency || pricing.interval)) {
							errors.push(`products[${i}].pricing.frequency is not allowed for one-time pricing`);
						}
					}
				}
			}
		}
	}

	return { valid: errors.length === 0, errors };
}
