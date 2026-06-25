import type { DiffEntry } from "@guapocado/shared";
import { describe, expect, it } from "vitest";
import {
	assertTargetKey,
	getActiveWorkspaceId,
	listWorkspaces,
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
