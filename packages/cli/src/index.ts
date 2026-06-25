import { defineCommand, runMain } from "citty";

const main = defineCommand({
	meta: {
		name: "guap",
		version: "0.0.2",
		description: "Guapocado CLI — typed monetisation infrastructure",
	},
	subCommands: {
		init: () => import("./commands/init.js").then((m) => m.default),
		login: () => import("./commands/login.js").then((m) => m.default),
		workspace: () => import("./commands/workspace.js").then((m) => m.default),
		pull: () => import("./commands/pull.js").then((m) => m.default),
		push: () => import("./commands/push.js").then((m) => m.default),
		diff: () => import("./commands/diff.js").then((m) => m.default),
		plan: () => import("./commands/plan.js").then((m) => m.default),
		generate: () => import("./commands/generate.js").then((m) => m.default),
		dev: () => import("./commands/dev.js").then((m) => m.default),
		listen: () => import("./commands/listen.js").then((m) => m.default),
	},
});

runMain(main);
