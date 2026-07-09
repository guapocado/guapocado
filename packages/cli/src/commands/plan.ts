import { type BillingConfig, diffConfigs } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig } from "../billing-config.js";
import { loadTargetConfig, resolveEnvironment } from "../config.js";
import { printDiff } from "../format-diff.js";

export default defineCommand({
	meta: { description: "Preview what changes a push would make" },
	args: {
		test: {
			type: "boolean",
			description: "Plan against the test environment using a sk_guap_test_ key",
		},
		live: {
			type: "boolean",
			description: "Plan against live using a sk_guap_live_ key",
		},
		sandbox: {
			type: "boolean",
			description: "Deprecated alias for --test.",
		},
		production: {
			type: "boolean",
			description: "Deprecated alias for --live.",
		},
		env: {
			type: "string",
			description: "Deprecated. Use --test or --live.",
		},
		config: {
			type: "string",
			alias: "c",
			description: "Path to a billing config file or its directory (default: current directory)",
		},
	},
	async run({ args }) {
		const environment = await resolveEnvironment({
			test: args.test as boolean | undefined,
			live: args.live as boolean | undefined,
			sandbox: args.sandbox as boolean | undefined,
			production: args.production as boolean | undefined,
			env: args.env as string | undefined,
		});
		const config = loadTargetConfig(environment);

		const local = await loadBillingConfig((args.config as string | undefined) ?? process.cwd());
		if (!local) {
			consola.error(
				"No billing config found. Expected one of: billing.config.ts, billing.config.json, guapocado.billing.json, guapocado.billing.yaml",
			);
			return;
		}

		let res: Response;
		try {
			res = await fetch(`${config.baseUrl}/v1/sync/pull`, {
				headers: { "x-guapocado-key": config.apiKey },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			consola.error(`Failed to reach Guapocado API at ${config.baseUrl}: ${message}`);
			return;
		}
		if (!res.ok) {
			consola.error(`Failed to pull remote config from ${config.baseUrl}: ${res.status}`);
			const body = await res.text().catch(() => "");
			if (body) consola.error(body);
			return;
		}
		const data = (await res.json()) as { config: BillingConfig };

		const diffs = diffConfigs(local, data.config);
		printDiff(diffs, config.environment);
	},
});
