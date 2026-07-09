import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import consola from "consola";
import {
	type Environment,
	ensureLocalCredentialsDir,
	migrateLegacyEnvironments,
	normalizeEnvironmentName,
	readStoredConfig,
	upsertWorkspaceKey,
	writeStoredConfig,
} from "../config.js";
import { hintGitignore } from "../hints.js";

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
			const envTarget: Environment = args.key.startsWith("sk_guap_live_") ? "live" : "test";
			const path = ensureLocalCredentialsDir();
			const existing = readStoredConfig();
			writeStoredConfig({
				...existing,
				defaultEnvironment: envTarget,
				environments: {
					...migrateLegacyEnvironments(existing.environments),
					[envTarget]: { apiKey: args.key },
				},
			});
			consola.success(`Credentials saved to ${path}`);
			hintGitignore();
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
				// The server may still use the legacy "sandbox"/"production" names.
				keys?: Partial<Record<string, string>>;
				// legacy single-key shape
				apiKey?: string;
				target?: string;
			};

			const workspaceId = token.workspaceId ?? "default";
			const rawEntries: Array<[Environment | null, string | undefined]> = token.keys
				? Object.entries(token.keys).map(([name, apiKey]) => [
						normalizeEnvironmentName(name),
						apiKey,
					])
				: token.apiKey
					? [[normalizeEnvironmentName(token.target) ?? "test", token.apiKey]]
					: [];
			const entries = rawEntries.filter(
				(entry): entry is [Environment, string] => Boolean(entry[0]) && Boolean(entry[1]),
			);

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
			hintGitignore();
			return;
		}

		throw new Error("Device login expired. Run `guap login` again.");
	},
});
