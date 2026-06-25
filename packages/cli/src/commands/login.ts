import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import consola from "consola";
import {
	type TargetMode,
	ensureLocalCredentialsDir,
	readStoredConfig,
	upsertWorkspaceKey,
	writeStoredConfig,
} from "../config.js";

function openBrowser(url: string): boolean {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", () => {});
	child.unref();
	return true;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default defineCommand({
	meta: { description: "Authenticate with the Guapocado platform" },
	args: {
		key: {
			type: "string",
			description: "Use an existing server API key instead of browser login",
		},
		"no-browser": {
			type: "boolean",
			description: "Print the device authorization URL instead of opening a browser",
		},
	},
	async run({ args }) {
		// A single login authorizes the chosen workspace for both environments.
		const baseUrl = "https://api.guapocado.dev";

		if (args.key) {
			// Manual key: the key prefix implies the environment.
			const envTarget: TargetMode = args.key.startsWith("sk_guap_live_") ? "production" : "sandbox";
			const path = ensureLocalCredentialsDir();
			const existing = readStoredConfig();
			writeStoredConfig({
				...existing,
				defaultEnvironment: envTarget,
				environments: { ...existing.environments, [envTarget]: { apiKey: args.key } },
			});
			consola.success(`Credentials saved to ${path}`);
			return;
		}

		const startRes = await fetch(`${baseUrl}/api/cli/device/start`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target: "both" }),
		});
		if (!startRes.ok) {
			throw new Error(`Could not start device login: ${startRes.status} ${await startRes.text()}`);
		}
		const start = (await startRes.json()) as {
			deviceCode: string;
			userCode: string;
			verificationUriComplete: string;
			expiresIn: number;
			interval: number;
		};

		consola.info(`Open this URL to authorize the CLI: ${start.verificationUriComplete}`);
		consola.info(`Code: ${start.userCode}`);
		if (!args["no-browser"]) {
			openBrowser(start.verificationUriComplete);
		}

		const deadline = Date.now() + start.expiresIn * 1000;
		while (Date.now() < deadline) {
			await sleep(start.interval * 1000);
			const tokenRes = await fetch(`${baseUrl}/api/cli/device/token`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ deviceCode: start.deviceCode }),
			});

			if (tokenRes.status === 428) continue;
			if (!tokenRes.ok) {
				throw new Error(`Device login failed: ${tokenRes.status} ${await tokenRes.text()}`);
			}

			const token = (await tokenRes.json()) as {
				workspaceId?: string;
				workspaceName?: string;
				keys?: Partial<Record<TargetMode, string>>;
				// legacy single-key shape
				apiKey?: string;
				target?: TargetMode;
			};

			const workspaceId = token.workspaceId ?? "default";
			const entries: Array<[TargetMode, string]> = (
				token.keys
					? (Object.entries(token.keys) as Array<[TargetMode, string]>)
					: token.apiKey
						? [[token.target ?? "sandbox", token.apiKey] as [TargetMode, string]]
						: []
			).filter(([, apiKey]) => Boolean(apiKey));

			let config = readStoredConfig();
			for (const [envTarget, apiKey] of entries) {
				config = upsertWorkspaceKey(config, {
					workspaceId,
					name: token.workspaceName,
					target: envTarget,
					apiKey,
					makeActive: true,
				});
			}
			const path = writeStoredConfig(config);
			const envs = entries.map(([t]) => t).join(" + ") || "no environments";
			consola.success(
				`Logged in to ${token.workspaceName ?? workspaceId} (${envs}). Saved to ${path}`,
			);
			return;
		}

		throw new Error("Device login expired. Run `guap login` again.");
	},
});
