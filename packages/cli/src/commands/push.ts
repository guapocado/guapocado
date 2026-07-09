import { type BillingConfig, diffConfigs, toCanonical } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig } from "../billing-config.js";
import { loadTargetConfig, resolveEnvironment } from "../config.js";
import { printDiff } from "../format-diff.js";
import { hintGitignore } from "../hints.js";

export default defineCommand({
	meta: { description: "Push billing config to Guapocado" },
	args: {
		test: {
			type: "boolean",
			description: "Push to the test environment using a sk_guap_test_ key",
		},
		live: {
			type: "boolean",
			description: "Push to live using a sk_guap_live_ key",
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
		const environment = await resolveEnvironment({
			test: args.test as boolean | undefined,
			live: args.live as boolean | undefined,
			sandbox: args.sandbox as boolean | undefined,
			production: args.production as boolean | undefined,
			env: args.env as string | undefined,
		});
		const config = loadTargetConfig(environment);
		hintGitignore();

		const configPath = (args.config as string | undefined) ?? process.cwd();
		const local = await loadBillingConfig(configPath);

		if (!local) {
			consola.error(
				"No billing config found. Expected one of: billing.config.ts, billing.config.json, guapocado.billing.json, guapocado.billing.yaml",
			);
			return;
		}
		const canonical = toCanonical(local);

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
