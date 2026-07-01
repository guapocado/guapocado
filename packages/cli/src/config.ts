import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GUAPOCADO_API_BASE_URL = "https://api.guapocado.dev";

export type Environment = "sandbox" | "production" | "development" | "staging";

export type CliConfig = {
	apiKey: string;
	baseUrl: string;
	environment: Environment;
};

export type TargetMode = "sandbox" | "production";

type StoredEnvKey = { apiKey: string };

/** Credentials for a single workspace (organization), one key per environment. */
export type WorkspaceCredentials = {
	name?: string;
	environments: Partial<Record<TargetMode, StoredEnvKey>>;
};

/** On-disk shape of `.guapocado/credentials.json`. Legacy fields are still read. */
export type StoredConfig = {
	activeWorkspace?: string;
	workspaces?: Record<string, WorkspaceCredentials>;
	// Legacy (pre-workspace) fields, still honored as a fallback.
	environments?: Record<string, StoredEnvKey>;
	apiKey?: string;
	defaultEnvironment?: Environment;
};

type DotEnv = Record<string, string>;

/** A workspace as surfaced to `workspace list` / `select`. */
export type WorkspaceSummary = {
	id: string;
	name?: string;
	active: boolean;
	environments: TargetMode[];
};

export function localCredentialsPath(cwd = process.cwd()): string {
	return join(cwd, ".guapocado", "credentials.json");
}

export function ensureLocalCredentialsDir(cwd = process.cwd()): string {
	const configDir = join(cwd, ".guapocado");
	mkdirSync(configDir, { recursive: true });
	return join(configDir, "credentials.json");
}

/**
 * Whether `.guapocado/` — which holds API keys — is git-ignored in `cwd`.
 * Returns `null` when it can't be determined (git isn't installed, or `cwd`
 * isn't a git repo) so callers can stay silent rather than nag. A trailing
 * `.guapocado` or `.guapocado/` pattern both resolve to `true`.
 */
export function isGuapocadoGitignored(cwd = process.cwd()): boolean | null {
	const result = spawnSync("git", ["check-ignore", "-q", ".guapocado"], {
		cwd,
		stdio: "ignore",
	});
	if (result.error) return null; // git not on PATH
	if (result.status === 0) return true; // ignored
	if (result.status === 1) return false; // tracked / not ignored
	return null; // 128 = not a repo, or anything unexpected
}

export function readStoredConfig(cwd = process.cwd()): StoredConfig {
	const path = localCredentialsPath(cwd);
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as StoredConfig;
	} catch {
		return {};
	}
}

export function writeStoredConfig(config: StoredConfig, cwd = process.cwd()): string {
	const path = ensureLocalCredentialsDir(cwd);
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, "utf-8");
	return path;
}

/** The active workspace id: the explicit one, or the only workspace, else undefined. */
export function getActiveWorkspaceId(config: StoredConfig): string | undefined {
	if (config.activeWorkspace && config.workspaces?.[config.activeWorkspace]) {
		return config.activeWorkspace;
	}
	const ids = Object.keys(config.workspaces ?? {});
	return ids.length === 1 ? ids[0] : undefined;
}

/** Pure: returns a copy of `config` with `activeWorkspace` set (must exist). */
export function setActiveWorkspace(config: StoredConfig, workspaceId: string): StoredConfig {
	if (!config.workspaces?.[workspaceId]) {
		throw new Error(`Unknown workspace: ${workspaceId}. Run \`guap login\` first.`);
	}
	return { ...config, activeWorkspace: workspaceId };
}

/** Pure: upserts a workspace's per-environment key and (optionally) marks it active. */
export function upsertWorkspaceKey(
	config: StoredConfig,
	input: {
		workspaceId: string;
		name?: string;
		target: TargetMode;
		apiKey: string;
		makeActive?: boolean;
	},
): StoredConfig {
	const workspaces = { ...(config.workspaces ?? {}) };
	const existing = workspaces[input.workspaceId];
	workspaces[input.workspaceId] = {
		name: input.name ?? existing?.name,
		environments: {
			...existing?.environments,
			[input.target]: { apiKey: input.apiKey },
		},
	};
	return {
		...config,
		workspaces,
		activeWorkspace: input.makeActive
			? input.workspaceId
			: (config.activeWorkspace ?? input.workspaceId),
	};
}

/** Workspaces known locally, with the active one flagged. */
export function listWorkspaces(config: StoredConfig): WorkspaceSummary[] {
	const activeId = getActiveWorkspaceId(config);
	return Object.entries(config.workspaces ?? {}).map(([id, ws]) => ({
		id,
		name: ws.name,
		active: id === activeId,
		environments: (Object.keys(ws.environments ?? {}) as TargetMode[]).sort(),
	}));
}

function targetKeyPrefix(target: TargetMode): string {
	return target === "sandbox" ? "sk_guap_test_" : "sk_guap_live_";
}

/**
 * User-facing label for a target. The CLI surface speaks test/live (matching the
 * platform's mode enum and `sk_guap_test_`/`sk_guap_live_` key prefixes); the
 * internal `TargetMode` and on-disk credential keys stay sandbox/production so
 * existing logins keep working.
 */
export function targetLabel(target: TargetMode): "test" | "live" {
	return target === "sandbox" ? "test" : "live";
}

/** Mask a key for display — keeps the `sk_guap_test_`/`live_` prefix and last 4 chars. */
export function maskApiKey(apiKey: string): string {
	if (!apiKey) return "(none)";
	const prefix = apiKey.match(/^sk_guap_(?:test|live)_/)?.[0] ?? apiKey.slice(0, 4);
	const last4 = apiKey.length > 4 ? apiKey.slice(-4) : "";
	return last4 ? `${prefix}…${last4}` : prefix;
}

function parseDotEnv(raw: string): DotEnv {
	const env: DotEnv = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) continue;

		const key = trimmed.slice(0, equalsIndex).trim();
		const value = trimmed
			.slice(equalsIndex + 1)
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (key) env[key] = value;
	}
	return env;
}

/** The `GUAPOCADO_API_KEY` from a local `.env`, or `null` when absent. */
export function readDotEnvApiKey(cwd = process.cwd()): string | null {
	const envPath = join(cwd, ".env");
	if (!existsSync(envPath)) return null;
	return parseDotEnv(readFileSync(envPath, "utf-8")).GUAPOCADO_API_KEY ?? null;
}

function loadDotEnvConfig(env?: Environment): CliConfig | null {
	const apiKey = readDotEnvApiKey();
	if (!apiKey) return null;

	return {
		apiKey,
		baseUrl: GUAPOCADO_API_BASE_URL,
		environment: env ?? (apiKey.startsWith("sk_guap_live_") ? "production" : "sandbox"),
	};
}

export function assertTargetKey(apiKey: string, target: TargetMode): void {
	const prefix = targetKeyPrefix(target);
	if (!apiKey.startsWith(prefix)) {
		throw new Error(
			`The ${targetLabel(target)} environment requires a ${prefix} server key. Run \`guap login\` to authorize it.`,
		);
	}
}

/** Resolves the API key for a workspace+target from any supported storage shape. */
export function resolveStoredKey(
	config: StoredConfig,
	target: TargetMode,
): { apiKey: string; workspaceId?: string } | null {
	const activeId = getActiveWorkspaceId(config);
	const fromWorkspace = activeId
		? config.workspaces?.[activeId]?.environments?.[target]?.apiKey
		: undefined;
	if (fromWorkspace) return { apiKey: fromWorkspace, workspaceId: activeId };

	const legacy = config.environments?.[target]?.apiKey;
	if (legacy) return { apiKey: legacy };

	if (config.apiKey) return { apiKey: config.apiKey };
	return null;
}

export function loadConfig(env?: Environment): CliConfig {
	const configPath = localCredentialsPath();
	if (!existsSync(configPath)) {
		const dotenvConfig = loadDotEnvConfig(env);
		if (dotenvConfig) return dotenvConfig;
		throw new Error(
			`Not logged in. Run \`guap login\` from this project, or set GUAPOCADO_API_KEY in ${join(process.cwd(), ".env")}. Checked ${configPath}.`,
		);
	}
	const stored = readStoredConfig();
	const environment = env ?? stored.defaultEnvironment ?? "development";

	if (environment === "sandbox" || environment === "production") {
		const resolved = resolveStoredKey(stored, environment);
		if (resolved) return { apiKey: resolved.apiKey, baseUrl: GUAPOCADO_API_BASE_URL, environment };
	}

	return {
		apiKey: stored.apiKey ?? "",
		baseUrl: GUAPOCADO_API_BASE_URL,
		environment,
	};
}

export function loadTargetConfig(target: TargetMode): CliConfig {
	const config = loadConfig(target);
	assertTargetKey(config.apiKey, target);
	return config;
}
