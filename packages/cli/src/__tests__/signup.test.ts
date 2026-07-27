import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signupAgent } from "../commands/signup.js";
import { localCredentialsPath, readStoredConfig } from "../config.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "guap-agent-signup-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function successResponse(apiKey = "sk_guap_test_secret"): Response {
	return Response.json(
		{
			registrationId: "areg_1",
			workspaceId: "ten_1",
			workspaceName: "Agent workspace",
			environment: "test",
			apiKey,
			claimUrl: "https://guapocado.dev/agent/claim?t=clm_secret",
			expiresAt: "2026-08-03T00:00:00.000Z",
		},
		{ status: 201 },
	);
}

describe("signupAgent", () => {
	it("stores the bootstrap key without returning or printing it", async () => {
		const result = await signupAgent({
			workspaceName: "Agent workspace",
			agentName: "codex",
			cwd: dir,
			fetchImpl: async () => successResponse(),
		});

		expect(result).not.toHaveProperty("apiKey");
		expect(result.claimUrl).toContain("/agent/claim");
		expect(readStoredConfig(dir).workspaces?.ten_1?.environments.test?.apiKey).toBe(
			"sk_guap_test_secret",
		);
		expect(readStoredConfig(dir).pendingAgentRegistration).toBeUndefined();
	});

	it("writes credential material with owner-only filesystem permissions", async () => {
		await signupAgent({
			workspaceName: "Agent workspace",
			cwd: dir,
			fetchImpl: async () => successResponse(),
		});

		if (process.platform !== "win32") {
			expect(statSync(localCredentialsPath(dir)).mode & 0o777).toBe(0o600);
			expect(statSync(join(dir, ".guapocado")).mode & 0o777).toBe(0o700);
		}
	});

	it("reuses the persisted clientId after a lost response", async () => {
		await expect(
			signupAgent({
				workspaceName: "Agent workspace",
				cwd: dir,
				fetchImpl: async () => {
					throw new Error("connection lost");
				},
			}),
		).rejects.toThrow("connection lost");
		const pendingClientId = readStoredConfig(dir).pendingAgentRegistration?.clientId;
		expect(pendingClientId).toHaveLength(64);

		let retriedClientId: string | undefined;
		await signupAgent({
			workspaceName: "Agent workspace",
			cwd: dir,
			fetchImpl: async (_url, init) => {
				retriedClientId = JSON.parse(String(init?.body)).clientId;
				return successResponse();
			},
		});
		expect(retriedClientId).toBe(pendingClientId);
	});
});
