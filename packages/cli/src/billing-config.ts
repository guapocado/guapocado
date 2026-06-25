import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type BillingConfig,
	type CanonicalBillingConfig,
	fromCanonical,
	toCanonical,
	validateCanonical,
} from "@guapocado/shared";
import consola from "consola";

const require = createRequire(import.meta.url);
const CONFIG_MARKER = "GUAPOCADO_CONFIG_JSON:";

type ConfigKind = "ts" | "json" | "canonical-json" | "yaml";
type ConfigTarget = { kind: ConfigKind; path: string };

// Standard config filenames, in resolution priority order.
const CONFIG_FILES: { kind: ConfigKind; name: string }[] = [
	{ kind: "ts", name: "billing.config.ts" },
	{ kind: "json", name: "billing.config.json" },
	{ kind: "canonical-json", name: "guapocado.billing.json" },
	{ kind: "yaml", name: "guapocado.billing.yaml" },
];

/** Finds the first standard billing config file inside a directory. */
function detectConfigInDir(dir: string): ConfigTarget | null {
	for (const { kind, name } of CONFIG_FILES) {
		const path = resolve(dir, name);
		if (existsSync(path)) return { kind, path };
	}
	return null;
}

/** Classifies an explicit config file path by its name/extension. */
function classifyConfigFile(path: string): ConfigTarget | null {
	const base = basename(path);
	if (base.endsWith(".ts")) return { kind: "ts", path };
	if (base === "guapocado.billing.json") return { kind: "canonical-json", path };
	if (base.endsWith(".yaml") || base.endsWith(".yml")) return { kind: "yaml", path };
	if (base.endsWith(".json")) return { kind: "json", path };
	return null;
}

/**
 * Resolves a `--config` value (or cwd) to a concrete config file.
 *
 * The argument may be a directory (standard filenames are auto-detected) or a
 * direct path to a config file — the latter is the monorepo case where the
 * config lives outside the directory you run `guap` from.
 */
function resolveConfigTarget(pathArg: string): ConfigTarget | null {
	if (existsSync(pathArg) && statSync(pathArg).isFile()) {
		const target = classifyConfigFile(resolve(pathArg));
		if (!target) {
			consola.error(
				`Unrecognised config file: ${pathArg}. Expected a .ts, .json, or .yaml billing config.`,
			);
		}
		return target;
	}
	return detectConfigInDir(pathArg);
}

function loadTypeScriptBillingConfig(cwd: string, tsPath: string): BillingConfig {
	const tsxPath = require.resolve("tsx");
	const configUrl = pathToFileURL(tsPath).href;
	const script = `
const mod = await import(${JSON.stringify(configUrl)});
const config = mod.default?.default ?? mod.default ?? mod;
process.stdout.write(${JSON.stringify(CONFIG_MARKER)} + JSON.stringify(config));
`;
	const output = execFileSync(
		process.execPath,
		[
			"--conditions=import",
			"--import",
			pathToFileURL(tsxPath).href,
			"--input-type=module",
			"--eval",
			script,
		],
		{ cwd, encoding: "utf-8", env: process.env },
	);
	const markerIndex = output.lastIndexOf(CONFIG_MARKER);
	if (markerIndex === -1) {
		throw new Error("billing.config.ts did not produce a serializable config");
	}
	return JSON.parse(output.slice(markerIndex + CONFIG_MARKER.length)) as BillingConfig;
}

/**
 * Loads a billing config from a directory (auto-detecting standard filenames)
 * or from a direct path to a config file (the `--config <path>` flag).
 */
export async function loadBillingConfig(pathArg: string): Promise<BillingConfig | null> {
	const target = resolveConfigTarget(pathArg);
	if (!target) return null;

	const cwd = dirname(target.path);

	switch (target.kind) {
		case "ts": {
			consola.info(`Detected ${basename(target.path)} — importing via tsx`);
			try {
				return loadTypeScriptBillingConfig(cwd, target.path);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				consola.error(`Failed to import ${basename(target.path)}: ${message}`);
				return null;
			}
		}
		case "json": {
			consola.info(`Detected ${basename(target.path)}`);
			return JSON.parse(readFileSync(target.path, "utf-8")) as BillingConfig;
		}
		case "canonical-json": {
			consola.info(`Detected ${basename(target.path)} (canonical format)`);
			const raw = JSON.parse(readFileSync(target.path, "utf-8"));
			const result = validateCanonical(raw);
			if (!result.valid) {
				for (const err of result.errors) consola.error(err);
				return null;
			}
			return fromCanonical(raw);
		}
		case "yaml": {
			consola.info(`Detected ${basename(target.path)} (canonical format)`);
			const { parse: parseYaml } = await import("yaml");
			const raw = parseYaml(readFileSync(target.path, "utf-8"));
			const result = validateCanonical(raw);
			if (!result.valid) {
				for (const err of result.errors) consola.error(err);
				return null;
			}
			return fromCanonical(raw);
		}
	}
}

export async function loadCanonicalBillingConfig(
	pathArg: string,
): Promise<CanonicalBillingConfig | null> {
	const billingConfig = await loadBillingConfig(pathArg);
	return billingConfig ? toCanonical(billingConfig) : null;
}
