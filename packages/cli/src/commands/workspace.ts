import { defineCommand } from "citty";
import consola from "consola";
import {
	listWorkspaces,
	readStoredConfig,
	setActiveWorkspace,
	writeStoredConfig,
} from "../config.js";

const list = defineCommand({
	meta: { description: "List the workspaces you've logged into" },
	run() {
		const config = readStoredConfig();
		const workspaces = listWorkspaces(config);
		if (workspaces.length === 0) {
			consola.info("No workspaces yet. Run `guap login` to add one.");
			return;
		}
		for (const ws of workspaces) {
			const marker = ws.active ? "●" : "○";
			const label = ws.name && ws.name !== ws.id ? `${ws.name} (${ws.id})` : ws.id;
			const envs = ws.environments.length ? ws.environments.join(", ") : "no keys";
			consola.log(`${marker} ${label}  —  ${envs}`);
		}
	},
});

const select = defineCommand({
	meta: { description: "Choose the active workspace (interactive)" },
	args: {
		workspace: {
			type: "positional",
			required: false,
			description: "Workspace id to select (skips the interactive prompt)",
		},
	},
	async run({ args }) {
		const config = readStoredConfig();
		const workspaces = listWorkspaces(config);
		if (workspaces.length === 0) {
			consola.info("No workspaces yet. Run `guap login` to add one.");
			return;
		}

		let chosen = args.workspace as string | undefined;
		if (!chosen) {
			chosen = (await consola.prompt("Select the active workspace", {
				type: "select",
				options: workspaces.map((ws) => ({
					label: `${ws.name ?? ws.id}${ws.active ? " (current)" : ""}`,
					value: ws.id,
					hint: ws.environments.join(", ") || "no keys",
				})),
			})) as string;
		}

		if (typeof chosen !== "string" || !config.workspaces?.[chosen]) {
			consola.warn("No workspace selected.");
			return;
		}

		const updated = setActiveWorkspace(config, chosen);
		writeStoredConfig(updated);
		consola.success(`Active workspace: ${updated.workspaces?.[chosen]?.name ?? chosen}`);
	},
});

export default defineCommand({
	meta: { name: "workspace", description: "Manage Guapocado workspaces (organizations)" },
	subCommands: { list, select },
});
