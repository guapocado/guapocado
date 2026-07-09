import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import consola from "consola";

const GUAPOCADO_API_BASE_URL = "https://api.guapocado.dev";

/**
 * Canonical environment / target names, matching the platform's test/live
 * vocabulary (`sk_guap_test_` / `sk_guap_live_` keys, `x-guapocado-env-mode`).
 * Legacy "sandbox"/"production" spellings are accepted only in the
 * read/normalize layer below (`normalizeEnvironmentName`, `readEnvironmentKey`,
 * `migrateLegacyEnvironments`) — never in this public type.
 */
export type Environment = "test" | "live";

/** @deprecated Use `Environment`. Kept as an alias so existing imports keep working. */
export type TargetMode = Environment;

export type CliConfig = {
	apiKey: string;
	baseUrl: string;
	environment: Environment;
};

type StoredEnvKey = { apiKey: string };

/**
 * Credentials for a single workspace (organization), one key per environment.
 * On disk this may still contain legacy `"sandbox"`/`"production"` keys from
 * before the test/live rename — read through `readEnvironmentKey` rather than
 * indexing `environments` directly.
 */
export type WorkspaceCredentials = {
	name?: string;
	environments: Partial<Record<string, StoredEnvKey>>;
};

/** On-disk shape of `.guapocado/credentials.json`. Legacy fields are still read. */
export type StoredConfig = {
	activeWorkspace?: string;
	workspaces?: Record<string, WorkspaceCredentials>;
	// Legacy (pre-workspace) fields, still honored as a fallback. May contain
	// legacy "sandbox"/"production" environment names.
	environments?: Record<string, StoredEnvKey>;
	apiKey?: string;
	defaultEnvironment?: string;
};

type DotEnv = Record<string, string>;

/** A workspace as surfaced to `workspace list` / `select`. */
export type WorkspaceSummary = {
	id: string;
	name?: string;
	active: boolean;
	environments: Environment[];
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

// --- Environment name normalization / aliasing -----------------------------
//
// The platform used to call these targets "sandbox"/"production"; they're now
// "test"/"live" everywhere (sk_guap_test_/sk_guap_live_ keys, the
// x-guapocado-env-mode header). Everything below keeps *reading* the legacy
// names working forever, while all *writes* use the canonical ones.

const LEGACY_ENVIRONMENT_ALIASES: Record<string, Environment> = {
	test: "test",
	live: "live",
	sandbox: "test",
	production: "live",
};

/**
 * Normalizes any known environment spelling — canonical (`test`/`live`) or
 * legacy (`sandbox`/`production`) — to the canonical `Environment`. Returns
 * `null` for anything else (including the old free-form "development"/
 * "staging" values, which never resolved to a real stored key).
 */
export function normalizeEnvironmentName(value: string | undefined | null): Environment | null {
	if (!value) return null;
	return LEGACY_ENVIRONMENT_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** The legacy name a canonical environment used to be stored/written under. */
function legacyNameFor(env: Environment): "sandbox" | "production" {
	return env === "test" ? "sandbox" : "production";
}

/**
 * Reads `target`'s key out of an `environments` map that may use legacy
 * (`sandbox`/`production`) or canonical (`test`/`live`) names. The canonical
 * name wins when both are present.
 */
export function readEnvironmentKey(
	environments: Partial<Record<string, StoredEnvKey>> | undefined,
	target: Environment,
): string | undefined {
	if (!environments) return undefined;
	return environments[target]?.apiKey ?? environments[legacyNameFor(target)]?.apiKey;
}

/**
 * Rewrites any legacy-named (`sandbox`/`production`) entries in an
 * `environments` map to their canonical (`test`/`live`) names, dropping the
 * legacy key. Canonical-named entries always win over a legacy duplicate.
 * Used on every credential write (e.g. `guap login`) so re-authenticating
 * cleans up old-format credentials automatically.
 */
export function migrateLegacyEnvironments(
	environments: Partial<Record<string, StoredEnvKey>> | undefined,
): Partial<Record<Environment, StoredEnvKey>> {
	const result: Partial<Record<Environment, StoredEnvKey>> = {};
	if (!environments) return result;
	// Legacy-named entries first...
	if (environments.sandbox) result.test = environments.sandbox;
	if (environments.production) result.live = environments.production;
	// ...then canonical-named entries win on conflict.
	if (environments.test) result.test = environments.test;
	if (environments.live) result.live = environments.live;
	return result;
}

/** Pure: upserts a workspace's per-environment key and (optionally) marks it active. */
export function upsertWorkspaceKey(
	config: StoredConfig,
	input: {
		workspaceId: string;
		name?: string;
		target: Environment;
		apiKey: string;
		makeActive?: boolean;
	},
): StoredConfig {
	const workspaces = { ...(config.workspaces ?? {}) };
	const existing = workspaces[input.workspaceId];
	workspaces[input.workspaceId] = {
		name: input.name ?? existing?.name,
		environments: {
			...migrateLegacyEnvironments(existing?.environments),
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

/** Environments with a stored key in a workspace, aliasing legacy names. */
function presentEnvironments(ws: WorkspaceCredentials | undefined): Environment[] {
	const found: Environment[] = [];
	for (const env of ["test", "live"] as const) {
		if (readEnvironmentKey(ws?.environments, env)) found.push(env);
	}
	return found;
}

/** Workspaces known locally, with the active one flagged. */
export function listWorkspaces(config: StoredConfig): WorkspaceSummary[] {
	const activeId = getActiveWorkspaceId(config);
	return Object.entries(config.workspaces ?? {}).map(([id, ws]) => ({
		id,
		name: ws.name,
		active: id === activeId,
		environments: presentEnvironments(ws).sort(),
	}));
}

function targetKeyPrefix(target: Environment): string {
	return target === "test" ? "sk_guap_test_" : "sk_guap_live_";
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

function loadDotEnvConfig(environment: Environment): CliConfig | null {
	const apiKey = readDotEnvApiKey();
	if (!apiKey) return null;

	return {
		apiKey,
		baseUrl: GUAPOCADO_API_BASE_URL,
		environment,
	};
}

export function assertTargetKey(apiKey: string, target: Environment): void {
	const prefix = targetKeyPrefix(target);
	if (!apiKey.startsWith(prefix)) {
		throw new Error(
			`${target} pushes require a ${prefix} server key. Run guap login from this project or configure .guapocado/credentials.json environments.${target}.`,
		);
	}
}

/** Resolves the API key for a workspace+target from any supported storage shape. */
export function resolveStoredKey(
	config: StoredConfig,
	target: Environment,
): { apiKey: string; workspaceId?: string } | null {
	const activeId = getActiveWorkspaceId(config);
	const fromWorkspace = activeId
		? readEnvironmentKey(config.workspaces?.[activeId]?.environments, target)
		: undefined;
	if (fromWorkspace) return { apiKey: fromWorkspace, workspaceId: activeId };

	const legacy = readEnvironmentKey(config.environments, target);
	if (legacy) return { apiKey: legacy };

	if (config.apiKey) return { apiKey: config.apiKey };
	return null;
}

export function loadConfig(environment: Environment): CliConfig {
	const configPath = localCredentialsPath();
	if (!existsSync(configPath)) {
		const dotenvConfig = loadDotEnvConfig(environment);
		if (dotenvConfig) return dotenvConfig;
		throw new Error(
			`Not logged in. Run \`guap login\` from this project, or set GUAPOCADO_API_KEY in ${join(process.cwd(), ".env")}. Checked ${configPath}.`,
		);
	}
	const stored = readStoredConfig();
	const resolved = resolveStoredKey(stored, environment);
	if (resolved) return { apiKey: resolved.apiKey, baseUrl: GUAPOCADO_API_BASE_URL, environment };

	return {
		apiKey: stored.apiKey ?? "",
		baseUrl: GUAPOCADO_API_BASE_URL,
		environment,
	};
}

export function loadTargetConfig(target: Environment): CliConfig {
	const config = loadConfig(target);
	assertTargetKey(config.apiKey, target);
	return config;
}

// --- No-flag environment resolution (never default to a keyless env) ------

/** Flags a command may accept to pick a target environment, canonical and legacy. */
export type EnvironmentFlags = {
	test?: boolean;
	live?: boolean;
	/** @deprecated use `test` */
	sandbox?: boolean;
	/** @deprecated use `live` */
	production?: boolean;
	/** Legacy free-form `--env` value. Only test/live/sandbox/production resolve. */
	env?: string;
};

/**
 * Resolves an explicit environment from CLI flags, honoring the deprecated
 * `--sandbox`/`--production`/`--env` aliases (with a one-line deprecation
 * notice). Returns `undefined` when the caller made no explicit choice — the
 * command should then fall back to `resolveEnvironment`'s interactive/error
 * path rather than defaulting to a keyless environment.
 */
export function explicitEnvironmentFromFlags(flags: EnvironmentFlags): Environment | undefined {
	const chosen = new Set<Environment>();
	if (flags.test) chosen.add("test");
	if (flags.live) chosen.add("live");
	if (flags.sandbox) {
		consola.warn("--sandbox is deprecated — use --test instead.");
		chosen.add("test");
	}
	if (flags.production) {
		consola.warn("--production is deprecated — use --live instead.");
		chosen.add("live");
	}
	if (chosen.size > 1) {
		throw new Error("Choose either --test or --live, not both.");
	}
	if (chosen.size === 1) return [...chosen][0];

	if (flags.env) {
		const normalized = normalizeEnvironmentName(flags.env);
		if (!normalized) {
			throw new Error(`Unknown --env "${flags.env}". Use --test or --live.`);
		}
		if (flags.env.toLowerCase() !== normalized) {
			consola.warn(`--env ${flags.env} is deprecated — use --${normalized} instead.`);
		}
		return normalized;
	}
	return undefined;
}

/** Environments with a stored key: the active workspace's, or the `.env` key's. */
export function availableEnvironments(cwd = process.cwd()): Environment[] {
	const found = new Set<Environment>();
	if (existsSync(localCredentialsPath(cwd))) {
		const stored = readStoredConfig(cwd);
		for (const target of ["test", "live"] as const) {
			if (resolveStoredKey(stored, target)) found.add(target);
		}
	} else {
		const apiKey = readDotEnvApiKey(cwd);
		if (apiKey) found.add(apiKey.startsWith("sk_guap_live_") ? "live" : "test");
	}
	return [...found];
}

/**
 * Resolves the target environment for a command, and NEVER falls back to a
 * keyless environment:
 *  - An explicit `--test`/`--live` (or deprecated alias) flag always wins.
 *  - Otherwise, if exactly one environment has a stored key, that one is used.
 *  - Otherwise, when interactive (a real TTY), the user is prompted to choose
 *    among the environments that actually have stored keys.
 *  - Otherwise (non-interactive, or nothing to choose from), this throws.
 */
export async function resolveEnvironment(
	flags: EnvironmentFlags,
	options: { cwd?: string; interactive?: boolean } = {},
): Promise<Environment> {
	const explicit = explicitEnvironmentFromFlags(flags);
	if (explicit) return explicit;

	const cwd = options.cwd ?? process.cwd();
	const available = availableEnvironments(cwd);

	if (available.length === 1) {
		const [only] = available as [Environment];
		consola.info(
			`No --test/--live given — using ${only} (the only environment with a stored key).`,
		);
		return only;
	}

	const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
	const noEnvSelectedError = () => new Error("Specify --test or --live (no environment selected).");

	if (!interactive) throw noEnvSelectedError();
	if (available.length === 0) {
		throw new Error("Specify --test or --live (no environment selected). Run `guap login` first.");
	}

	const chosen = await consola.prompt("Select the target environment", {
		type: "select",
		options: available.map((env) => ({ label: env, value: env })),
	});
	if (chosen === "test" || chosen === "live") return chosen;
	throw noEnvSelectedError();
}
