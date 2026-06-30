import { type BillingConfig, diffConfigs } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig } from "../billing-config.js";
import { type Environment, loadConfig, loadTargetConfig, targetLabel } from "../config.js";
import { printDiff } from "../format-diff.js";
import { resolveTargetMode, targetArgs } from "../target-args.js";

export default defineCommand({
	meta: { description: "Preview what changes a push would make" },
	args: {
		env: {
			type: "string",
			description: "Environment (development, staging, production)",
		},
		...targetArgs,
		config: {
			type: "string",
			alias: "c",
			description: "Path to a billing config file or its directory (default: current directory)",
		},
	},
	async run({ args }) {
		const target = resolveTargetMode(args);
		const config = target
			? loadTargetConfig(target)
			: loadConfig(args.env as Environment | undefined);
		const envLabel = target ? targetLabel(target) : config.environment;

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
		printDiff(diffs, envLabel);
	},
});
