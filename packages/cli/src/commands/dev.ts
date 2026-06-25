import { execSync, spawn } from "node:child_process";
import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
	meta: { description: "Start local development server" },
	args: {
		port: {
			type: "string",
			description: "Port for the dev server",
			default: "4777",
		},
	},
	async run({ args }) {
		const port = args.port;

		try {
			execSync("which wrangler", { stdio: "ignore" });
		} catch {
			consola.error("wrangler not found. Install it: npm install -g wrangler");
			process.exit(1);
		}

		consola.info(`Starting Guapocado dev server on port ${port}...`);
		consola.info("Press Ctrl+C to stop\n");

		const child = spawn("wrangler", ["dev", "--port", port], {
			stdio: "inherit",
			shell: true,
		});

		child.on("error", (err) => {
			consola.error("Failed to start dev server:", err.message);
			process.exit(1);
		});

		child.on("exit", (code) => {
			process.exit(code ?? 0);
		});

		process.on("SIGINT", () => {
			child.kill("SIGINT");
		});
	},
});
