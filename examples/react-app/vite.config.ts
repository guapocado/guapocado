import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: [
			{
				find: "@guapocado/react/ui/primitives",
				replacement: resolve(__dirname, "../../packages/react/src/ui/primitives/index.ts"),
			},
			{
				find: "@guapocado/react/ui",
				replacement: resolve(__dirname, "../../packages/react/src/ui/index.ts"),
			},
			{
				find: "@guapocado/react",
				replacement: resolve(__dirname, "../../packages/react/src/index.ts"),
			},
			{
				find: "@guapocado/sdk",
				replacement: resolve(__dirname, "../../packages/sdk/src/index.ts"),
			},
			{
				find: "@guapocado/shared",
				replacement: resolve(__dirname, "../../packages/shared/src/index.ts"),
			},
		],
	},
});
