import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffEntry } from "@guapocado/shared";
import consola from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertTargetKey,
	availableEnvironments,
	explicitEnvironmentFromFlags,
	getActiveWorkspaceId,
	isGuapocadoGitignored,
	listWorkspaces,
	loadTargetConfig,
	maskApiKey,
	migrateLegacyEnvironments,
	normalizeEnvironmentName,
	readDotEnvApiKey,
	readEnvironmentKey,
	resolveEnvironment,
	resolveStoredKey,
	setActiveWorkspace,
	upsertWorkspaceKey,
	writeStoredConfig,
} from "../config.js";
import { renderDiff, renderDiffHeader } from "../format-diff.js";

describe("renderDiff", () => {
	it("formats added / removed / changed entries", () => {
		const diffs: DiffEntry[] = [
			{ type: "added", path: "products.pro" },
			{ type: "removed", path: "products.legacy" },
			{ type: "changed", path: "entitlements.api.requests", oldValue: 1000, newValue: 5000 },
		];
		const lines = renderDiff(diffs);
		expect(lines[0]).toContain("+ products.pro");
		expect(lines[1]).toContain("- products.legacy");
		expect(lines[2]).toContain("~ entitlements.api.requests");
		expect(lines[2]).toContain("1000");
		expect(lines[2]).toContain("5000");
	});

	it("warns when a pricing path changes", () => {
		const [line] = renderDiff([
			{ type: "changed", path: "products.pro.pricing.amount", oldValue: 4900, newValue: 9900 },
		]);
		expect(line).toMatch(/existing subscribers keep current price/);
	});
});

describe("renderDiffHeader", () => {
	it("reports zero, one, and many", () => {
		expect(renderDiffHeader([], "sandbox")).toBe("No config changes detected (sandbox).");
		expect(renderDiffHeader([{ type: "added", path: "a" }], "production")).toContain(
			"1 change (production)",
		);
		expect(
			renderDiffHeader(
				[
					{ type: "added", path: "a" },
					{ type: "added", path: "b" },
				],
				"sandbox",
			),
		).toContain("2 changes (sandbox)");
	});
});

describe("assertTargetKey", () => {
	it("accepts a key whose prefix matches the target", () => {
		expect(() => assertTargetKey("sk_guap_test_abc", "test")).not.toThrow();
		expect(() => assertTargetKey("sk_guap_live_abc", "live")).not.toThrow();
	});

	it("rejects a mismatched or non-server key", () => {
		expect(() => assertTargetKey("sk_guap_live_abc", "test")).toThrow(/sk_guap_test_/);
		expect(() => assertTargetKey("sk_guap_test_abc", "live")).toThrow(/sk_guap_live_/);
		expect(() => assertTargetKey("ck_guap_test_abc", "test")).toThrow();
	});
});

describe("normalizeEnvironmentName", () => {
	it("maps legacy names to canonical ones, in either case", () => {
		expect(normalizeEnvironmentName("sandbox")).toBe("test");
		expect(normalizeEnvironmentName("production")).toBe("live");
		expect(normalizeEnvironmentName("SANDBOX")).toBe("test");
		expect(normalizeEnvironmentName("Production")).toBe("live");
	});

	it("passes canonical names through", () => {
		expect(normalizeEnvironmentName("test")).toBe("test");
		expect(normalizeEnvironmentName("live")).toBe("live");
	});

	it("rejects unknown / old free-form names", () => {
		expect(normalizeEnvironmentName("development")).toBeNull();
		expect(normalizeEnvironmentName("staging")).toBeNull();
		expect(normalizeEnvironmentName(undefined)).toBeNull();
		expect(normalizeEnvironmentName("")).toBeNull();
	});
});

describe("readEnvironmentKey", () => {
	it("reads canonical names directly", () => {
		expect(readEnvironmentKey({ test: { apiKey: "sk_guap_test_a" } }, "test")).toBe(
			"sk_guap_test_a",
		);
		expect(readEnvironmentKey({ live: { apiKey: "sk_guap_live_a" } }, "live")).toBe(
			"sk_guap_live_a",
		);
	});

	it("aliases legacy names to canonical targets (read back-compat)", () => {
		expect(readEnvironmentKey({ sandbox: { apiKey: "sk_guap_test_legacy" } }, "test")).toBe(
			"sk_guap_test_legacy",
		);
		expect(readEnvironmentKey({ production: { apiKey: "sk_guap_live_legacy" } }, "live")).toBe(
			"sk_guap_live_legacy",
		);
	});

	it("prefers the canonical name when both are present", () => {
		expect(
			readEnvironmentKey(
				{ sandbox: { apiKey: "sk_guap_test_old" }, test: { apiKey: "sk_guap_test_new" } },
				"test",
			),
		).toBe("sk_guap_test_new");
	});

	it("returns undefined when neither name is present", () => {
		expect(readEnvironmentKey(undefined, "test")).toBeUndefined();
		expect(readEnvironmentKey({}, "live")).toBeUndefined();
	});
});

describe("migrateLegacyEnvironments", () => {
	it("rewrites legacy names to canonical ones", () => {
		const migrated = migrateLegacyEnvironments({
			sandbox: { apiKey: "sk_guap_test_a" },
			production: { apiKey: "sk_guap_live_a" },
		});
		expect(migrated).toEqual({
			test: { apiKey: "sk_guap_test_a" },
			live: { apiKey: "sk_guap_live_a" },
		});
	});

	it("drops the legacy key once migrated (no duplicate sandbox/test entries)", () => {
		const migrated = migrateLegacyEnvironments({ sandbox: { apiKey: "sk_guap_test_a" } });
		expect(Object.keys(migrated)).toEqual(["test"]);
		expect(migrated.test).toEqual({ apiKey: "sk_guap_test_a" });
	});

	it("prefers a canonical-named entry over a legacy duplicate", () => {
		const migrated = migrateLegacyEnvironments({
			sandbox: { apiKey: "sk_guap_test_old" },
			test: { apiKey: "sk_guap_test_new" },
		});
		expect(migrated.test).toEqual({ apiKey: "sk_guap_test_new" });
	});

	it("handles an empty/undefined map", () => {
		expect(migrateLegacyEnvironments(undefined)).toEqual({});
		expect(migrateLegacyEnvironments({})).toEqual({});
	});
});

describe("workspace credentials", () => {
	it("upserts per-workspace env keys and tracks the active workspace", () => {
		let cfg = upsertWorkspaceKey(
			{},
			{
				workspaceId: "org_1",
				name: "Acme",
				target: "test",
				apiKey: "sk_guap_test_a",
				makeActive: true,
			},
		);
		cfg = upsertWorkspaceKey(cfg, {
			workspaceId: "org_1",
			target: "live",
			apiKey: "sk_guap_live_a",
		});

		expect(getActiveWorkspaceId(cfg)).toBe("org_1");
		expect(resolveStoredKey(cfg, "test")?.apiKey).toBe("sk_guap_test_a");
		expect(resolveStoredKey(cfg, "live")?.apiKey).toBe("sk_guap_live_a");

		const list = listWorkspaces(cfg);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			id: "org_1",
			name: "Acme",
			active: true,
			environments: ["live", "test"],
		});
	});

	it("switches the active workspace and resolves its keys", () => {
		let cfg = upsertWorkspaceKey(
			{},
			{ workspaceId: "org_1", target: "test", apiKey: "sk_guap_test_a", makeActive: true },
		);
		cfg = upsertWorkspaceKey(cfg, {
			workspaceId: "org_2",
			name: "Beta",
			target: "test",
			apiKey: "sk_guap_test_b",
		});

		expect(getActiveWorkspaceId(cfg)).toBe("org_1");
		cfg = setActiveWorkspace(cfg, "org_2");
		expect(getActiveWorkspaceId(cfg)).toBe("org_2");
		expect(resolveStoredKey(cfg, "test")?.apiKey).toBe("sk_guap_test_b");
		expect(() => setActiveWorkspace(cfg, "org_unknown")).toThrow();
	});

	it("falls back to legacy environments and flat apiKey", () => {
		expect(
			resolveStoredKey({ environments: { sandbox: { apiKey: "sk_guap_test_legacy" } } }, "test")
				?.apiKey,
		).toBe("sk_guap_test_legacy");
		expect(resolveStoredKey({ apiKey: "sk_flat" }, "live")?.apiKey).toBe("sk_flat");
		expect(resolveStoredKey({}, "test")).toBeNull();
	});

	it("re-login (upsertWorkspaceKey) migrates a legacy-named workspace to canonical names", () => {
		// A workspace persisted before the rename, storing a "sandbox" key.
		let cfg: Parameters<typeof upsertWorkspaceKey>[0] = {
			workspaces: {
				org_1: { name: "Acme", environments: { sandbox: { apiKey: "sk_guap_test_old" } } },
			},
			activeWorkspace: "org_1",
		};
		// Re-login writes the live key under the canonical name.
		cfg = upsertWorkspaceKey(cfg, {
			workspaceId: "org_1",
			target: "live",
			apiKey: "sk_guap_live_a",
			makeActive: true,
		});

		expect(cfg.workspaces?.org_1?.environments).toEqual({
			test: { apiKey: "sk_guap_test_old" },
			live: { apiKey: "sk_guap_live_a" },
		});
	});
});

describe("back-compat: legacy credentials.json fixture authenticates against test/live", () => {
	// A real credentials.json from before the rename: workspaces[id].environments
	// keyed by "sandbox"/"production", with activeWorkspace set. This must
	// authenticate against --test/--live targets without requiring a re-login.
	const legacyFixture = {
		activeWorkspace: "org_legacy",
		workspaces: {
			org_legacy: {
				name: "Legacy Co",
				environments: {
					sandbox: { apiKey: "sk_guap_test_legacyfixture" },
					production: { apiKey: "sk_guap_live_legacyfixture" },
				},
			},
		},
	};

	it("resolveStoredKey reads both targets from the legacy-named fixture", () => {
		expect(resolveStoredKey(legacyFixture, "test")?.apiKey).toBe("sk_guap_test_legacyfixture");
		expect(resolveStoredKey(legacyFixture, "live")?.apiKey).toBe("sk_guap_live_legacyfixture");
	});

	it("loadTargetConfig resolves --live and --test from an on-disk legacy fixture", () => {
		const dir = mkdtempSync(join(tmpdir(), "guap-legacy-creds-"));
		try {
			writeStoredConfig(legacyFixture, dir);
			const originalCwd = process.cwd();
			process.chdir(dir);
			try {
				const live = loadTargetConfig("live");
				expect(live.apiKey).toBe("sk_guap_live_legacyfixture");
				expect(live.environment).toBe("live");

				const test = loadTargetConfig("test");
				expect(test.apiKey).toBe("sk_guap_test_legacyfixture");
				expect(test.environment).toBe("test");
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lists both environments as present for the legacy-named workspace", () => {
		const list = listWorkspaces(legacyFixture);
		expect(list[0]).toMatchObject({ id: "org_legacy", environments: ["live", "test"] });
	});
});

describe("explicitEnvironmentFromFlags", () => {
	it("prefers --test/--live over the deprecated aliases", () => {
		expect(explicitEnvironmentFromFlags({ test: true, sandbox: true })).toBe("test");
		expect(explicitEnvironmentFromFlags({ live: true })).toBe("live");
	});

	it("honors the deprecated --sandbox/--production aliases", () => {
		const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
		expect(explicitEnvironmentFromFlags({ sandbox: true })).toBe("test");
		expect(explicitEnvironmentFromFlags({ production: true })).toBe("live");
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("honors a legacy --env value, normalized", () => {
		const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
		expect(explicitEnvironmentFromFlags({ env: "sandbox" })).toBe("test");
		expect(explicitEnvironmentFromFlags({ env: "live" })).toBe("live");
		warnSpy.mockRestore();
	});

	it("throws when both --test and --live are given", () => {
		expect(() => explicitEnvironmentFromFlags({ test: true, live: true })).toThrow(
			/Choose either --test or --live/,
		);
	});

	it("throws on an unrecognized --env value instead of silently defaulting", () => {
		expect(() => explicitEnvironmentFromFlags({ env: "development" })).toThrow(/Unknown --env/);
	});

	it("returns undefined when nothing was specified", () => {
		expect(explicitEnvironmentFromFlags({})).toBeUndefined();
	});
});

describe("resolveEnvironment (no-flag resolution)", () => {
	let dir: string;
	const originalCwd = process.cwd();

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "guap-resolve-env-"));
		process.chdir(dir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	});

	it("an explicit flag always wins, even with stored credentials present", async () => {
		writeStoredConfig({
			workspaces: { org_1: { environments: { test: { apiKey: "sk_guap_test_a" } } } },
			activeWorkspace: "org_1",
		});
		await expect(resolveEnvironment({ live: true }, { interactive: true })).resolves.toBe("live");
	});

	it("defaults to the only stored environment without prompting", async () => {
		writeStoredConfig({
			workspaces: { org_1: { environments: { test: { apiKey: "sk_guap_test_a" } } } },
			activeWorkspace: "org_1",
		});
		const promptSpy = vi.spyOn(consola, "prompt");
		await expect(resolveEnvironment({}, { interactive: true })).resolves.toBe("test");
		expect(promptSpy).not.toHaveBeenCalled();
		promptSpy.mockRestore();
	});

	it("prompts among available environments when interactive and ambiguous", async () => {
		writeStoredConfig({
			workspaces: {
				org_1: {
					environments: {
						test: { apiKey: "sk_guap_test_a" },
						live: { apiKey: "sk_guap_live_a" },
					},
				},
			},
			activeWorkspace: "org_1",
		});
		const promptSpy = vi.spyOn(consola, "prompt").mockResolvedValue("live");
		await expect(resolveEnvironment({}, { interactive: true })).resolves.toBe("live");
		expect(promptSpy).toHaveBeenCalledWith(
			expect.stringContaining("Select the target environment"),
			expect.objectContaining({ type: "select" }),
		);
		promptSpy.mockRestore();
	});

	it("errors instead of defaulting to a keyless environment when non-interactive", async () => {
		writeStoredConfig({
			workspaces: {
				org_1: {
					environments: {
						test: { apiKey: "sk_guap_test_a" },
						live: { apiKey: "sk_guap_live_a" },
					},
				},
			},
			activeWorkspace: "org_1",
		});
		await expect(resolveEnvironment({}, { interactive: false })).rejects.toThrow(
			/Specify --test or --live \(no environment selected\)/,
		);
	});

	it("errors instead of defaulting to a keyless environment with no stored credentials at all", async () => {
		await expect(resolveEnvironment({}, { interactive: false })).rejects.toThrow(
			/Specify --test or --live/,
		);
		await expect(resolveEnvironment({}, { interactive: true })).rejects.toThrow(
			/Specify --test or --live/,
		);
	});
});

describe("availableEnvironments", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "guap-available-env-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("aliases legacy-named stored keys when listing available environments", () => {
		writeStoredConfig(
			{
				workspaces: { org_1: { environments: { sandbox: { apiKey: "sk_guap_test_a" } } } },
				activeWorkspace: "org_1",
			},
			dir,
		);
		expect(availableEnvironments(dir)).toEqual(["test"]);
	});

	it("infers the environment from a .env key when there's no credentials.json", () => {
		writeFileSync(join(dir, ".env"), 'GUAPOCADO_API_KEY="sk_guap_live_fromenv"\n');
		expect(availableEnvironments(dir)).toEqual(["live"]);
	});

	it("returns an empty list when nothing is configured", () => {
		expect(availableEnvironments(dir)).toEqual([]);
	});
});

describe("maskApiKey", () => {
	it("keeps the server-key prefix and last 4 chars, hiding the rest", () => {
		const masked = maskApiKey("sk_guap_test_abcdef1234");
		expect(masked).toBe("sk_guap_test_…1234");
		expect(masked).not.toContain("abcdef");
		expect(maskApiKey("sk_guap_live_zzzz9876")).toBe("sk_guap_live_…9876");
	});

	it("handles unknown shapes and empties without throwing", () => {
		expect(maskApiKey("")).toBe("(none)");
		expect(maskApiKey("abcdef")).toBe("abcd…cdef");
	});
});

describe("readDotEnvApiKey", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "guap-env-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns the GUAPOCADO_API_KEY from .env", () => {
		writeFileSync(join(dir, ".env"), 'GUAPOCADO_API_KEY="sk_guap_test_fromenv"\nOTHER=1\n');
		expect(readDotEnvApiKey(dir)).toBe("sk_guap_test_fromenv");
	});

	it("returns null when there is no .env or no key", () => {
		expect(readDotEnvApiKey(dir)).toBeNull();
		writeFileSync(join(dir, ".env"), "OTHER=1\n");
		expect(readDotEnvApiKey(dir)).toBeNull();
	});
});

describe("isGuapocadoGitignored", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "guap-cli-"));
		execFileSync("git", ["init", "-q"], { cwd: dir });
		mkdirSync(join(dir, ".guapocado"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns false when .guapocado is not gitignored", () => {
		writeFileSync(join(dir, ".gitignore"), "node_modules\n");
		expect(isGuapocadoGitignored(dir)).toBe(false);
	});

	it("returns true for both .guapocado and .guapocado/ patterns", () => {
		writeFileSync(join(dir, ".gitignore"), ".guapocado/\n");
		expect(isGuapocadoGitignored(dir)).toBe(true);
		writeFileSync(join(dir, ".gitignore"), ".guapocado\n");
		expect(isGuapocadoGitignored(dir)).toBe(true);
	});

	it("returns null outside a git repo", () => {
		const plain = mkdtempSync(join(tmpdir(), "guap-plain-"));
		try {
			expect(isGuapocadoGitignored(plain)).toBeNull();
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}
	});
});
