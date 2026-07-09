import { defineCommand } from "citty";
import consola from "consola";
import {
	type Environment,
	getActiveWorkspaceId,
	listWorkspaces,
	localCredentialsPath,
	maskApiKey,
	normalizeEnvironmentName,
	readDotEnvApiKey,
	readEnvironmentKey,
	readStoredConfig,
} from "../config.js";

/** Print `label`-aligned `value` rows. */
function table(rows: Array<[string, string]>): void {
	const width = Math.max(...rows.map(([label]) => label.length));
	for (const [label, value] of rows) {
		consola.log(`${label.padEnd(width)}  ${value}`);
	}
}

export default defineCommand({
	meta: { description: "Show the active workspace and the credentials in use" },
	run() {
		const config = readStoredConfig();
		const activeId = getActiveWorkspaceId(config);
		const active = activeId ? config.workspaces?.[activeId] : undefined;

		// Modern per-workspace keys, falling back to the legacy per-environment shape.
		const targets: Environment[] = ["test", "live"];
		const keyed = targets
			.map((target): [Environment, string] | null => {
				const key =
					readEnvironmentKey(active?.environments, target) ??
					readEnvironmentKey(config.environments, target);
				return key ? [target, key] : null;
			})
			.filter((e): e is [Environment, string] => e !== null);

		if (keyed.length > 0 || config.apiKey) {
			const rows: Array<[string, string]> = [];
			if (activeId) {
				const label =
					active?.name && active.name !== activeId ? `${active.name} (${activeId})` : activeId;
				rows.push(["Workspace:", label]);
			}
			if (config.defaultEnvironment) {
				rows.push([
					"Default env:",
					normalizeEnvironmentName(config.defaultEnvironment) ?? config.defaultEnvironment,
				]);
			}
			for (const [target, key] of keyed) rows.push([`${target}:`, maskApiKey(key)]);
			if (keyed.length === 0 && config.apiKey) rows.push(["key:", maskApiKey(config.apiKey)]);
			rows.push(["Source:", localCredentialsPath()]);
			table(rows);

			const all = listWorkspaces(config);
			if (all.length > 1) {
				consola.log(
					`\n${all.length} workspaces logged in — switch with \`guap workspace select\`.`,
				);
			}
			return;
		}

		// No stored credentials — fall back to a key in `.env`.
		const envKey = readDotEnvApiKey();
		if (envKey) {
			const env = envKey.startsWith("sk_guap_live_") ? "live" : "test";
			table([["API key:", `${maskApiKey(envKey)}  (${env}, from .env)`]]);
			return;
		}

		consola.info("Not logged in. Run `guap login`, or set GUAPOCADO_API_KEY in .env.");
	},
});
