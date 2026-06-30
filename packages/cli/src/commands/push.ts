import { type BillingConfig, diffConfigs } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig, loadCanonicalBillingConfig } from "../billing-config.js";
import { type Environment, loadConfig, loadTargetConfig } from "../config.js";
import { printDiff } from "../format-diff.js";
import { hintGitignore } from "../hints.js";

export default defineCommand({
	meta: { description: "Push billing config to Guapocado" },
	args: {
		env: {
			type: "string",
			description: "Legacy environment name",
		},
		sandbox: {
			type: "boolean",
			description: "Push to the sandbox environment using a sk_guap_test_ key",
		},
		production: {
			type: "boolean",
			description: "Push to production using a sk_guap_live_ key",
		},
		accept: {
			type: "boolean",
			alias: "a",
			description: "Skip the confirmation prompt (diff is still printed)",
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
		hintGitignore();

		const configPath = (args.config as string | undefined) ?? process.cwd();
		const [local, canonical] = await Promise.all([
			loadBillingConfig(configPath),
			loadCanonicalBillingConfig(configPath),
		]);

		if (!local || !canonical) {
			consola.error(
				"No billing config found. Expected one of: billing.config.ts, billing.config.json, guapocado.billing.json, guapocado.billing.yaml",
			);
			return;
		}

		// Pull remote config for diff. Failure is non-fatal — the environment may not be set up yet.
		let remote: BillingConfig | null = null;
		try {
			const res = await fetch(`${config.baseUrl}/v1/sync/pull`, {
				headers: { "x-guapocado-key": config.apiKey },
			});
			if (res.ok) {
				const data = (await res.json()) as { config: BillingConfig };
				remote = data.config;
			}
		} catch {
			// Offline or environment not yet initialised — proceed without diff.
		}

		if (remote) {
			const diffs = diffConfigs(local, remote);
			printDiff(diffs, config.environment);

			if (diffs.length > 0 && !args.accept) {
				const confirmed = await consola.prompt(
					`Apply ${diffs.length === 1 ? "this change" : "these changes"} to ${config.environment}?`,
					{ type: "confirm", initial: false },
				);
				if (!confirmed) {
					consola.info("Push cancelled.");
					return;
				}
			}
		}

		consola.info(`Pushing to ${config.environment}...`);
		const res = await fetch(`${config.baseUrl}/v1/sync/push`, {
			method: "POST",
			headers: {
				"x-guapocado-key": config.apiKey,
				"content-type": "application/json",
			},
			body: JSON.stringify({ config: canonical }),
		});

		if (!res.ok) {
			const err = await res.text();
			consola.error(`Failed to push: ${res.status} ${err}`);
			return;
		}

		const result = (await res.json()) as {
			synced: boolean;
			stripeSynced: boolean;
			webhookForwarding?: number;
		};
		consola.success(
			`Pushed config to ${config.environment} (stripe synced: ${result.stripeSynced})`,
		);
		if (result.webhookForwarding && result.webhookForwarding > 0) {
			consola.info(
				`Webhook forwarding declarations: ${result.webhookForwarding}. Auto-registering integrations will register receiver URLs when the app is reachable.`,
			);
		}
	},
});
