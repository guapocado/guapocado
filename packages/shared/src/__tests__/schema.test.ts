import { describe, expect, it } from "vitest";
import type { BillingConfig } from "../index.js";
import {
	billingConfigSchema,
	defineBilling,
	diffConfigs,
	fromCanonical,
	hashConfig,
	toCanonical,
	validateCanonical,
	versionConfig,
} from "../index.js";

const config: BillingConfig = {
	entitlements: {
		"ai.summary": { type: "feature" },
		"api.requests": { type: "meter", reset: "monthly" },
		"team.seats": { type: "limit" },
	},
	products: [
		{
			key: "free",
			name: "Free",
			entitlements: {
				"ai.summary": false,
				"api.requests": { included: 1000 },
				"team.seats": { included: 1 },
			},
		},
		{
			key: "pro",
			name: "Pro",
			pricing: {
				mode: "recurring",
				type: "flat",
				amount: 4900,
				currency: "usd",
				frequency: "month",
			},
			entitlements: {
				"ai.summary": true,
				"api.requests": { included: 40000 },
				"team.seats": { included: 10 },
			},
		},
	],
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("defineBilling / billingConfigSchema", () => {
	it("accepts a valid config", () => {
		const result = defineBilling(config);
		expect(result.products).toHaveLength(2);
		expect(Object.keys(result.entitlements)).toContain("api.requests");
	});

	it("rejects structurally invalid input", () => {
		expect(() => defineBilling(null as unknown as BillingConfig)).toThrow();
		expect(billingConfigSchema.safeParse(null).success).toBe(false);
		expect(billingConfigSchema.safeParse({ entitlements: 5, products: [] }).success).toBe(false);
	});

	it("rejects a recurring product with no frequency", () => {
		const bad = {
			entitlements: { f: { type: "feature" } },
			products: [
				{ key: "p", pricing: { mode: "recurring", type: "flat", amount: 100, currency: "usd" } },
			],
		};
		expect(billingConfigSchema.safeParse(bad).success).toBe(false);
	});
});

describe('mode: "custom" ("contact us") pricing', () => {
	const enterprise = {
		entitlements: { f: { type: "feature" } },
		products: [
			{
				key: "enterprise",
				name: "Enterprise",
				pricing: { mode: "custom", contact: "mailto:sales@example.com" },
				entitlements: { f: true },
			},
		],
	};

	it("accepts a custom tier with no Stripe price and an optional contact", () => {
		const parsed = billingConfigSchema.safeParse(enterprise);
		expect(parsed.success).toBe(true);
		const pricing = parsed.success ? parsed.data.products[0]?.pricing : undefined;
		expect(pricing).toEqual({ mode: "custom", contact: "mailto:sales@example.com" });
	});

	it("rejects a custom tier that carries amount/frequency", () => {
		const bad = {
			entitlements: { f: { type: "feature" } },
			products: [
				{
					key: "e",
					pricing: { mode: "custom", amount: 100, frequency: "month" },
					entitlements: {},
				},
			],
		};
		expect(billingConfigSchema.safeParse(bad).success).toBe(false);
	});

	it("round-trips a custom tier through canonical and validates", () => {
		const canonical = toCanonical(enterprise as unknown as BillingConfig);
		expect(validateCanonical(canonical)).toEqual({ valid: true, errors: [] });
		const back = fromCanonical(canonical);
		expect(back.products[0]?.pricing).toEqual({
			mode: "custom",
			contact: "mailto:sales@example.com",
		});
	});

	it("validateCanonical rejects a custom tier with frequency", () => {
		const result = validateCanonical({
			version: 1,
			entitlements: { f: { type: "feature" } },
			products: [{ key: "e", pricing: { mode: "custom", frequency: "month" }, entitlements: {} }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.join(" ")).toMatch(/custom tiers must not include/);
	});
});

describe("canonical schema", () => {
	it("round-trips config <-> canonical", () => {
		const canonical = toCanonical(config);
		expect(canonical.version).toBe(1);
		const back = fromCanonical(canonical);
		expect(back.products.map((p) => p.key)).toEqual(["free", "pro"]);
		expect(Object.keys(back.entitlements).sort()).toEqual(Object.keys(config.entitlements).sort());
	});

	it("validateCanonical accepts a valid canonical doc", () => {
		expect(validateCanonical(toCanonical(config))).toEqual({ valid: true, errors: [] });
	});

	it("threads checkout.allowedRedirectHosts through schema + canonical", () => {
		const withCheckout = { ...config, checkout: { allowedRedirectHosts: ["app.example.com"] } };
		expect(billingConfigSchema.safeParse(withCheckout).success).toBe(true);
		const back = fromCanonical(toCanonical(withCheckout));
		expect(back.checkout?.allowedRedirectHosts).toEqual(["app.example.com"]);
	});

	it("validateCanonical rejects bad input", () => {
		expect(validateCanonical(null).valid).toBe(false);
		expect(validateCanonical({ version: 0, entitlements: {} }).valid).toBe(false);
		const badType = validateCanonical({
			version: 1,
			entitlements: { x: { type: "bogus" } },
			products: [],
		});
		expect(badType.valid).toBe(false);
		expect(badType.errors.join(" ")).toMatch(/type must be one of/);
	});
});

describe("hashConfig / versionConfig", () => {
	it("is deterministic and order-insensitive to identical input", () => {
		expect(hashConfig(config)).toBe(hashConfig(clone(config)));
	});

	it("changes when the config changes", () => {
		const changed = clone(config);
		const product = changed.products[0];
		expect(product).toBeDefined();
		if (product) product.name = "Free Tier";
		expect(hashConfig(changed)).not.toBe(hashConfig(config));
	});

	it("versionConfig attaches a version/hash", () => {
		const versioned = versionConfig(config);
		expect(versioned.version).toBe(hashConfig(config));
	});
});

describe("diffConfigs", () => {
	it("reports no changes for identical configs", () => {
		expect(diffConfigs(config, clone(config))).toEqual([]);
	});

	it("detects a changed product", () => {
		const remote = clone(config);
		const pro = remote.products[1];
		expect(pro).toBeDefined();
		if (pro) {
			pro.pricing = {
				mode: "recurring",
				type: "flat",
				amount: 9900,
				currency: "usd",
				frequency: "month",
			};
		}
		const diff = diffConfigs(config, remote);
		expect(diff.length).toBeGreaterThan(0);
	});
});
