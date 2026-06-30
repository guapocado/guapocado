import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BILLING_SCHEMA_VERSION, type BillingConfig, toCanonical } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { type Environment, loadConfig } from "../config.js";
import { hintGitignore } from "../hints.js";

function toTypeScript(config: BillingConfig): string {
	const lines: string[] = [];
	lines.push('import { defineBilling } from "@guapocado/shared";');
	lines.push("");
	lines.push("export default defineBilling({");
	lines.push("\tentitlements: {");
	for (const [key, ent] of Object.entries(config.entitlements)) {
		const props = [`type: "${ent.type}"`];
		if (ent.reset) props.push(`reset: "${ent.reset}"`);
		lines.push(`\t\t"${key}": { ${props.join(", ")} },`);
	}
	lines.push("\t},");
	lines.push("\tproducts: [");
	for (const p of config.products) {
		lines.push("\t\t{");
		lines.push(`\t\t\tkey: "${p.key}",`);
		if (p.name) lines.push(`\t\t\tname: "${p.name}",`);
		if (p.pricing) {
			const pp: string[] = [`mode: "${p.pricing.mode}"`, `type: "${p.pricing.type}"`];
			if (p.pricing.amount != null) pp.push(`amount: ${p.pricing.amount}`);
			if (p.pricing.currency) pp.push(`currency: "${p.pricing.currency}"`);
			if (p.pricing.mode === "recurring") {
				pp.push(`frequency: "${p.pricing.frequency}"`);
			}
			lines.push(`\t\t\tpricing: { ${pp.join(", ")} },`);
		}
		lines.push("\t\t\tentitlements: {");
		for (const [k, v] of Object.entries(p.entitlements)) {
			lines.push(`\t\t\t\t"${k}": ${JSON.stringify(v)},`);
		}
		lines.push("\t\t\t},");
		lines.push("\t\t},");
	}
	lines.push("\t],");
	lines.push("});");
	return lines.join("\n");
}

export default defineCommand({
	meta: { description: "Pull billing config from Guapocado" },
	args: {
		env: {
			type: "string",
			description: "Environment (development, staging, production)",
		},
		format: {
			type: "string",
			description: "Output format: json (canonical), yaml, ts (TypeScript defineBilling wrapper)",
			default: "json",
		},
	},
	async run({ args }) {
		const config = loadConfig(args.env as Environment | undefined);
		hintGitignore();
		consola.info(`Pulling from ${config.environment}...`);
		const res = await fetch(`${config.baseUrl}/v1/sync/pull`, {
			headers: { "x-guapocado-key": config.apiKey },
		});
		if (!res.ok) {
			consola.error(`Failed to pull: ${res.status} ${res.statusText}`);
			return;
		}
		const data = (await res.json()) as { config: BillingConfig };

		const canonical = toCanonical(data.config, "https://api.guapocado.dev/v1/schema/billing");

		if (args.format === "ts") {
			const target = resolve(process.cwd(), "billing.config.ts");
			writeFileSync(target, toTypeScript(data.config), "utf-8");
			consola.success(`Pulled config to ${target} (TypeScript)`);
		} else if (args.format === "yaml") {
			const { stringify: toYaml } = await import("yaml");
			const target = resolve(process.cwd(), "guapocado.billing.yaml");
			writeFileSync(target, toYaml(canonical), "utf-8");
			consola.success(`Pulled config to ${target} (YAML, v${BILLING_SCHEMA_VERSION})`);
		} else {
			const target = resolve(process.cwd(), "guapocado.billing.json");
			writeFileSync(target, JSON.stringify(canonical, null, "\t"), "utf-8");
			consola.success(`Pulled config to ${target} (canonical JSON, v${BILLING_SCHEMA_VERSION})`);
		}
	},
});
