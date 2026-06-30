import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffEntry } from "@guapocado/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertTargetKey,
	getActiveWorkspaceId,
	isGuapocadoGitignored,
	listWorkspaces,
	maskApiKey,
	readDotEnvApiKey,
	resolveStoredKey,
	setActiveWorkspace,
	upsertWorkspaceKey,
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
		expect(() => assertTargetKey("sk_guap_test_abc", "sandbox")).not.toThrow();
		expect(() => assertTargetKey("sk_guap_live_abc", "production")).not.toThrow();
	});

	it("rejects a mismatched or non-server key", () => {
		expect(() => assertTargetKey("sk_guap_live_abc", "sandbox")).toThrow(/sk_guap_test_/);
		expect(() => assertTargetKey("sk_guap_test_abc", "production")).toThrow(/sk_guap_live_/);
		expect(() => assertTargetKey("ck_guap_test_abc", "sandbox")).toThrow();
	});
});

describe("workspace credentials", () => {
	it("upserts per-workspace env keys and tracks the active workspace", () => {
		let cfg = upsertWorkspaceKey(
			{},
			{
				workspaceId: "org_1",
				name: "Acme",
				target: "sandbox",
				apiKey: "sk_guap_test_a",
				makeActive: true,
			},
		);
		cfg = upsertWorkspaceKey(cfg, {
			workspaceId: "org_1",
			target: "production",
			apiKey: "sk_guap_live_a",
		});

		expect(getActiveWorkspaceId(cfg)).toBe("org_1");
		expect(resolveStoredKey(cfg, "sandbox")?.apiKey).toBe("sk_guap_test_a");
		expect(resolveStoredKey(cfg, "production")?.apiKey).toBe("sk_guap_live_a");

		const list = listWorkspaces(cfg);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			id: "org_1",
			name: "Acme",
			active: true,
			environments: ["production", "sandbox"],
		});
	});

	it("switches the active workspace and resolves its keys", () => {
		let cfg = upsertWorkspaceKey(
			{},
			{ workspaceId: "org_1", target: "sandbox", apiKey: "sk_guap_test_a", makeActive: true },
		);
		cfg = upsertWorkspaceKey(cfg, {
			workspaceId: "org_2",
			name: "Beta",
			target: "sandbox",
			apiKey: "sk_guap_test_b",
		});

		expect(getActiveWorkspaceId(cfg)).toBe("org_1");
		cfg = setActiveWorkspace(cfg, "org_2");
		expect(getActiveWorkspaceId(cfg)).toBe("org_2");
		expect(resolveStoredKey(cfg, "sandbox")?.apiKey).toBe("sk_guap_test_b");
		expect(() => setActiveWorkspace(cfg, "org_unknown")).toThrow();
	});

	it("falls back to legacy environments and flat apiKey", () => {
		expect(
			resolveStoredKey({ environments: { sandbox: { apiKey: "sk_guap_test_legacy" } } }, "sandbox")
				?.apiKey,
		).toBe("sk_guap_test_legacy");
		expect(resolveStoredKey({ apiKey: "sk_flat" }, "production")?.apiKey).toBe("sk_flat");
		expect(resolveStoredKey({}, "sandbox")).toBeNull();
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
