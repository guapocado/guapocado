import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BILLING_SCHEMA_VERSION } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";

const TS_TEMPLATE = `import { defineBilling } from "@guapocado/shared";

export default defineBilling({
\tentitlements: {
\t\t"feature.example": {
\t\t\ttype: "feature",
\t\t},
\t\t"api.requests": {
\t\t\ttype: "meter",
\t\t\treset: "monthly",
\t\t},
\t\tseats: {
\t\t\ttype: "limit",
\t\t},
\t},
\tproducts: [
\t\t{
\t\t\tkey: "free",
\t\t\tentitlements: {
\t\t\t\t"feature.example": false,
\t\t\t\t"api.requests": { included: 1000 },
\t\t\t\tseats: { included: 1 },
\t\t\t},
\t\t},
\t\t{
\t\t\tkey: "pro",
\t\t\tentitlements: {
\t\t\t\t"feature.example": true,
\t\t\t\t"api.requests": {
\t\t\t\t\tincluded: 100000,
\t\t\t\t\toverage: {
\t\t\t\t\t\tallowed: true,
\t\t\t\t\t\tunit: 10000,
\t\t\t\t\t\tamount: 500,
\t\t\t\t\t\tcurrency: "usd",
\t\t\t\t\t},
\t\t\t\t},
\t\t\t\tseats: {
\t\t\t\t\tincluded: 10,
\t\t\t\t\texpansion: {
\t\t\t\t\t\tallowed: true,
\t\t\t\t\t\tunit: 1,
\t\t\t\t\t\tamount: 1200,
\t\t\t\t\t\tcurrency: "usd",
\t\t\t\t\t},
\t\t\t\t},
\t\t\t},
\t\t},
\t],
\t// generate: {
\t// \ttables: {
\t// \t\tenabled: true,
\t// \t\torm: "drizzle",
\t// \t\tdb: "sqlite",
\t// \t},
\t// },
});
`;

const JSON_TEMPLATE = {
	$schema: "https://api.guapocado.dev/v1/schema/billing",
	version: BILLING_SCHEMA_VERSION,
	entitlements: {
		"feature.example": { type: "feature" },
		"api.requests": { type: "meter", reset: "monthly" },
		seats: { type: "limit" },
	},
	products: [
		{
			key: "free",
			entitlements: {
				"feature.example": false,
				"api.requests": { included: 1000 },
				seats: { included: 1 },
			},
		},
		{
			key: "pro",
			entitlements: {
				"feature.example": true,
				"api.requests": {
					included: 100000,
					overage: { allowed: true, unit: 10000, amount: 500, currency: "usd" },
				},
				seats: {
					included: 10,
					expansion: { allowed: true, unit: 1, amount: 1200, currency: "usd" },
				},
			},
		},
	],
};

function existingConfigPath(): string | null {
	const candidates = [
		"guapocado.billing.json",
		"guapocado.billing.yaml",
		"billing.config.json",
		"billing.config.ts",
	];
	for (const candidate of candidates) {
		const target = resolve(process.cwd(), candidate);
		if (existsSync(target)) return candidate;
	}
	return null;
}

export default defineCommand({
	meta: { description: "Initialise a billing config in your project" },
	args: {
		format: {
			type: "string",
			description: "Output format: ts (TypeScript) or json (canonical JSON)",
			default: "ts",
		},
	},
	run({ args }) {
		const existing = existingConfigPath();
		if (existing) {
			consola.warn(`${existing} already exists`);
			return;
		}

		if (args.format === "json") {
			const target = resolve(process.cwd(), "guapocado.billing.json");
			writeFileSync(target, JSON.stringify(JSON_TEMPLATE, null, "\t"), "utf-8");
			consola.success("Created guapocado.billing.json (canonical format with $schema)");
		} else {
			const target = resolve(process.cwd(), "billing.config.ts");
			writeFileSync(target, TS_TEMPLATE, "utf-8");
			consola.success("Created billing.config.ts");
		}
	},
});
