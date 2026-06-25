import { type BillingConfig, diffConfigs } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig } from "../billing-config.js";
import { type Environment, loadConfig, loadTargetConfig } from "../config.js";
import { printDiff } from "../format-diff.js";

export default defineCommand({
	meta: { description: "Preview what changes a push would make" },
	args: {
		env: {
			type: "string",
			description: "Environment (development, staging, production)",
		},
		sandbox: {
			type: "boolean",
			description: "Plan against the sandbox environment using a sk_guap_test_ key",
		},
		production: {
			type: "boolean",
			description: "Plan against production using a sk_guap_live_ key",
		},
		config: {
			type: "string",
			alias: "c",
			description: "Path to a billing config file or its directory (default: current directory)",
		},
	},
	async run({ args }) {
		if (args.sandbox && args.production) {
			throw new Error("Choose either --sandbox or --production, not both.");
		}
		const config = args.sandbox
			? loadTargetConfig("sandbox")
			: args.production
				? loadTargetConfig("production")
				: loadConfig(args.env as Environment | undefined);

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
