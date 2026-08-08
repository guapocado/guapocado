import { randomBytes } from "node:crypto";
import { defineCommand } from "citty";
import consola from "consola";
import {
	GUAPOCADO_API_BASE_URL,
	readStoredConfig,
	upsertWorkspaceKey,
	writeStoredConfig,
} from "../config.js";
import { hintGitignore } from "../hints.js";

type RegistrationResponse = {
	registrationId: string;
	provisionalWorkspaceId?: string;
	workspaceId: string;
	workspaceName: string;
	environment: "test";
	apiKey: string;
	claimUrl: string;
	expiresAt: string;
};

export type AgentSignupResult = Omit<RegistrationResponse, "apiKey"> & {
	credentialStored: true;
};

export async function signupAgent(input: {
	workspaceName: string;
	agentName?: string;
	cwd?: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}): Promise<AgentSignupResult> {
	const cwd = input.cwd ?? process.cwd();
	const fetchImpl = input.fetchImpl ?? fetch;
	const baseUrl = (input.baseUrl ?? GUAPOCADO_API_BASE_URL).replace(/\/$/, "");
	const existing = readStoredConfig(cwd);
	const pending =
		existing.pendingAgentRegistration?.workspaceName === input.workspaceName
			? existing.pendingAgentRegistration
			: {
					clientId: randomBytes(32).toString("hex"),
					workspaceName: input.workspaceName,
				};

	// Persist the retry handle before the request. If the process loses its
	// connection after the server commits, rerunning the same command retrieves
	// the same encrypted registration material instead of leaking another tenant.
	writeStoredConfig({ ...existing, pendingAgentRegistration: pending }, cwd);

	const response = await fetchImpl(`${baseUrl}/api/agent/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			clientId: pending.clientId,
			workspaceName: input.workspaceName,
			agentName: input.agentName,
			source: "guapocado-cli",
		}),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as {
			error?: string;
			code?: string;
		};
		throw new Error(
			body.error ??
				`Could not create an agent workspace (${response.status}${body.code ? ` ${body.code}` : ""}).`,
		);
	}

	const registration = (await response.json()) as RegistrationResponse;
	if (
		!registration.workspaceId ||
		!registration.apiKey?.startsWith("sk_guap_test_") ||
		!registration.claimUrl ||
		registration.environment !== "test"
	) {
		throw new Error("The registration service returned an invalid response.");
	}

	const withWorkspace = upsertWorkspaceKey(existing, {
		workspaceId: registration.workspaceId,
		name: registration.workspaceName,
		target: "test",
		apiKey: registration.apiKey,
		makeActive: true,
	});
	const { pendingAgentRegistration: _, ...completed } = withWorkspace;
	writeStoredConfig(completed, cwd);

	return {
		registrationId: registration.registrationId,
		provisionalWorkspaceId: registration.provisionalWorkspaceId ?? registration.workspaceId,
		workspaceId: registration.workspaceId,
		workspaceName: registration.workspaceName,
		environment: registration.environment,
		claimUrl: registration.claimUrl,
		expiresAt: registration.expiresAt,
		credentialStored: true,
	};
}

export default defineCommand({
	meta: { description: "Create a claimable test workspace for an AI agent" },
	args: {
		agent: {
			type: "boolean",
			description: "Confirm this is an agent-native, claimable signup",
		},
		name: {
			type: "string",
			description: "Workspace name",
			default: "Agent workspace",
		},
		"agent-name": {
			type: "string",
			description: "Name of the agent creating the workspace",
		},
		json: {
			type: "boolean",
			description: "Print machine-readable JSON",
		},
	},
	async run({ args }) {
		if (!args.agent) {
			throw new Error("Agent-native signup requires the explicit --agent flag.");
		}
		const result = await signupAgent({
			workspaceName: String(args.name),
			agentName: args["agent-name"] ? String(args["agent-name"]) : undefined,
		});
		if (args.json) {
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return;
		}

		consola.success(`Created claimable test workspace: ${result.workspaceName}`);
		consola.info(`Claim it before ${result.expiresAt}:`);
		consola.info(result.claimUrl);
		consola.info("The agent credential is stored locally and was not printed.");
		hintGitignore();
	},
});
