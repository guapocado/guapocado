import type { BillingConfig } from "@guapocado/shared";
import { defineCommand } from "citty";
import consola from "consola";
import { loadBillingConfig } from "../billing-config.js";
import { loadTargetConfig } from "../config.js";

const DEFAULT_LOCAL_URL = "http://localhost:3010/api/auth/guap";
const DEFAULT_REGISTRATION_KEY = "better-auth:/guap";
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

type LocalReceiverRegistration = {
	enabled?: boolean;
	id?: string;
	status?: string;
	url?: string;
	relay?: DevRelaySession | null;
};

type DevRelaySession = {
	receiverId: string;
	publicUrl: string;
	connectUrl: string;
	expiresAt: string;
};

type RelayRequestMessage = {
	type: "request";
	id: string;
	method: string;
	path: string;
	headers: Array<[string, string]>;
	body: string;
};

type RelayMessage =
	| RelayRequestMessage
	| { type: "ready"; receiverId: string; heartbeatIntervalMs?: number }
	| { type: "pong"; at?: string };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRelayRequestMessage(message: RelayMessage): message is RelayRequestMessage {
	return message.type === "request";
}

async function loadProjectConfig(pathArg?: string): Promise<BillingConfig | null> {
	return loadBillingConfig(pathArg ?? process.cwd());
}

function inferRegistrationKey(config: BillingConfig | null, explicit: string | undefined): string {
	if (explicit?.trim()) return explicit.trim();
	const receiver = config?.webhooks?.forwarding?.[0];
	if (receiver?.integration === "better-auth") return DEFAULT_REGISTRATION_KEY;
	if (receiver?.integration) return `integration:${receiver.integration}`;
	return DEFAULT_REGISTRATION_KEY;
}

function assertLocalTarget(rawUrl: string, allowNonLoopback: boolean): void {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("--to must be an absolute local URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("--to must use http or https");
	}
	const hostname = url.hostname.toLowerCase();
	const loopback =
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]";
	if (!loopback && !allowNonLoopback) {
		throw new Error(
			"Dev relay targets must be localhost by default. Pass --allow-non-loopback only when you trust the target network.",
		);
	}
}

async function shouldStartDevRelay(config: BillingConfig | null): Promise<boolean> {
	if (!config?.webhooks?.devTunnel) {
		consola.info(
			"Skipping Guapocado dev relay because webhooks.devTunnel is not true in billing.config.ts.",
		);
		return false;
	}
	return true;
}

function headersForLocalRequest(headers: Array<[string, string]>, publicUrl: string): Headers {
	const next = new Headers();
	for (const [key, value] of headers) {
		const lower = key.toLowerCase();
		if (lower === "host" || lower === "content-length" || lower === "connection") continue;
		if (lower.startsWith("x-guapocado-dev-relay-")) continue;
		next.append(key, value);
	}
	next.set("x-guapocado-public-url", publicUrl);
	return next;
}

function responseHeaders(headers: Headers): Array<[string, string]> {
	const next: Array<[string, string]> = [];
	headers.forEach((value, key) => {
		const lower = key.toLowerCase();
		if (lower === "content-length" || lower === "content-encoding") return;
		next.push([key, value]);
	});
	return next;
}

function sendJson(socket: WebSocket, value: unknown): void {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

async function registerLocalReceiver(
	localUrl: string,
	publicUrl: string,
	apiKey: string,
): Promise<LocalReceiverRegistration> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 20; attempt++) {
		try {
			const res = await fetch(localUrl, {
				method: "GET",
				headers: {
					"x-guapocado-dev-relay": "register",
					"x-guapocado-key": apiKey,
					"x-guapocado-public-url": publicUrl,
				},
			});

			if (res.ok) {
				const text = await res.text();
				try {
					return text ? (JSON.parse(text) as LocalReceiverRegistration) : {};
				} catch {
					return {};
				}
			}

			const body = await res.text();
			const details = body.trim() || res.statusText || "No response body";
			lastError = new Error(
				`Local receiver registration failed: ${res.status} ${details}. Check the local app logs for ${localUrl}. If this is a Better Auth app, make sure the Guapocado plugin tables exist in the local auth database.`,
			);
		} catch (error) {
			lastError = error;
		}
		if (attempt < 20) await sleep(500);
	}
	throw lastError instanceof Error ? lastError : new Error("Local receiver registration failed");
}

async function bootstrapLocalReceiver(
	localUrl: string,
	apiKey: string,
): Promise<LocalReceiverRegistration> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 20; attempt++) {
		try {
			const res = await fetch(localUrl, {
				method: "GET",
				headers: {
					"x-guapocado-dev-relay": "bootstrap",
					"x-guapocado-key": apiKey,
				},
			});

			if (res.ok) {
				const text = await res.text();
				try {
					return text ? (JSON.parse(text) as LocalReceiverRegistration) : {};
				} catch {
					return {};
				}
			}

			const body = await res.text();
			const details = body.trim() || res.statusText || "No response body";
			lastError = new Error(
				`Local receiver bootstrap failed: ${res.status} ${details}. Check the local app logs for ${localUrl}.`,
			);
		} catch (error) {
			lastError = error;
		}
		if (attempt < 20) await sleep(500);
	}
	throw lastError instanceof Error ? lastError : new Error("Local receiver bootstrap failed");
}

async function startRelaySession(input: {
	baseUrl: string;
	apiKey: string;
	registrationKey: string;
}): Promise<DevRelaySession> {
	const response = await fetch(`${input.baseUrl}/v1/dev-relay/session`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-guapocado-key": input.apiKey,
		},
		body: JSON.stringify({ registrationKey: input.registrationKey }),
	});
	if (!response.ok) {
		const details = await response.text();
		throw new Error(
			`Could not start Guapocado dev relay: ${response.status} ${details.trim() || response.statusText}`,
		);
	}
	return (await response.json()) as DevRelaySession;
}

async function assertRelayOnline(publicUrl: string): Promise<void> {
	const response = await fetch(`${publicUrl}/status`, {
		method: "GET",
		signal: AbortSignal.timeout(5_000),
	});
	if (!response.ok) {
		throw new Error(`Guapocado dev relay status check failed: ${response.status}`);
	}
	const status = (await response.json()) as { connected?: boolean };
	if (!status.connected) {
		throw new Error("Guapocado dev relay socket is not connected");
	}
}

function connectWebSocket(url: string): Promise<WebSocket> {
	if (typeof WebSocket === "undefined") {
		throw new Error("This Node.js runtime does not provide WebSocket. Use Node 22 or newer.");
	}
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error("Timed out connecting to Guapocado dev relay"));
		}, 10_000);
		socket.addEventListener(
			"open",
			() => {
				clearTimeout(timeout);
				resolve(socket);
			},
			{ once: true },
		);
		socket.addEventListener(
			"error",
			() => {
				clearTimeout(timeout);
				reject(new Error("Could not connect to Guapocado dev relay"));
			},
			{ once: true },
		);
	});
}

async function handleRelayRequest(input: {
	socket: WebSocket;
	message: RelayRequestMessage;
	localUrl: string;
	publicUrl: string;
}): Promise<void> {
	const startedAt = Date.now();
	const method = input.message.method || "POST";
	const body = Buffer.from(input.message.body, "base64");
	try {
		const response = await fetch(input.localUrl, {
			method,
			headers: headersForLocalRequest(input.message.headers, input.publicUrl),
			body: method === "GET" || method === "HEAD" ? undefined : body,
			signal: AbortSignal.timeout(25_000),
		});
		const responseBody = Buffer.from(await response.arrayBuffer()).toString("base64");
		sendJson(input.socket, {
			type: "response",
			id: input.message.id,
			status: response.status,
			headers: responseHeaders(response.headers),
			body: responseBody,
		});
		consola.info(
			`Forwarded webhook ${method} ${input.message.path} -> ${response.status} in ${Date.now() - startedAt}ms`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Local webhook receiver failed";
		sendJson(input.socket, {
			type: "response",
			id: input.message.id,
			status: 502,
			headers: [["content-type", "text/plain"]],
			body: Buffer.from(message).toString("base64"),
		});
		consola.error(
			`Webhook forwarding failed ${method} ${input.message.path} in ${Date.now() - startedAt}ms: ${message}`,
		);
	}
}

function announceRegistration(
	session: DevRelaySession,
	registration: LocalReceiverRegistration,
): void {
	if (registration.url && registration.url !== session.publicUrl) {
		consola.warn(
			`Local receiver registered ${registration.url}, but the active relay is ${session.publicUrl}. Re-register the local receiver from this project if the dashboard shows a different endpoint.`,
		);
	}
	consola.success(`Listening for Guapocado test webhooks at ${session.publicUrl}`);
	consola.success("Guapocado dev relay connected");
	consola.info(`Relay session expires at ${session.expiresAt}`);
	if (registration.id) {
		consola.info(
			`Registered endpoint ${registration.id} (${registration.status ?? "unknown"}) for ${registration.url ?? session.publicUrl}`,
		);
	}
	if (registration.status !== "active") {
		consola.info("Approve the generated local dev receiver in the Guapocado dashboard if needed.");
	}
}

export default defineCommand({
	meta: { description: "Listen for Guapocado webhooks and forward them to local dev" },
	args: {
		to: {
			type: "string",
			description: "Local webhook URL to forward to",
			default: DEFAULT_LOCAL_URL,
		},
		test: {
			type: "boolean",
			description: "Listen for test webhooks. (default; live is not supported)",
		},
		live: {
			type: "boolean",
			description: "Not supported. Dev relay never forwards live webhooks.",
		},
		sandbox: {
			type: "boolean",
			description: "Deprecated alias for --test.",
		},
		production: {
			type: "boolean",
			description: "Deprecated alias for --live. Not supported.",
		},
		dev: {
			type: "boolean",
			description: "Start only when the project billing config has webhooks.devTunnel: true.",
		},
		"registration-key": {
			type: "string",
			description: "Stable webhook registration key. Defaults to the Better Auth receiver key.",
		},
		"allow-non-loopback": {
			type: "boolean",
			description: "Allow forwarding to a non-loopback URL. Use only for trusted local networks.",
		},
		config: {
			type: "string",
			alias: "c",
			description: "Path to a billing config file or its directory (default: current directory)",
		},
	},
	async run({ args }) {
		if (args.production || args.live) {
			throw new Error("guap listen is dev-only and only supports test webhooks.");
		}
		if (args.sandbox) {
			consola.warn("--sandbox is deprecated — use --test instead.");
		}

		const localUrl = String(args.to);
		assertLocalTarget(localUrl, Boolean(args["allow-non-loopback"]));

		const projectConfig = await loadProjectConfig(args.config as string | undefined);
		if (args.dev && !(await shouldStartDevRelay(projectConfig))) return;
		const config = loadTargetConfig("test");
		let registration = await bootstrapLocalReceiver(localUrl, config.apiKey);
		let session = registration.relay ?? null;
		if (!session) {
			const registrationKey = inferRegistrationKey(
				projectConfig,
				typeof args["registration-key"] === "string" ? args["registration-key"] : undefined,
			);
			session = await startRelaySession({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				registrationKey,
			});
			registration = await registerLocalReceiver(localUrl, session.publicUrl, config.apiKey);
		}
		const socket = await connectWebSocket(session.connectUrl);
		await assertRelayOnline(session.publicUrl);

		let stopped = false;
		let lastPongAt = Date.now();
		let heartbeat: ReturnType<typeof setInterval> | null = null;
		const stop = (exitCode: number) => {
			if (stopped) return;
			stopped = true;
			if (heartbeat) clearInterval(heartbeat);
			socket.close();
			process.exit(exitCode);
		};

		const fail = (message: string) => {
			if (stopped) return;
			consola.error(message);
			consola.error("Webhook listener stopped. Restart guap listen to reconnect the dev relay.");
			stop(1);
		};

		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			let message: RelayMessage;
			try {
				message = JSON.parse(event.data) as RelayMessage;
			} catch {
				return;
			}
			if (message.type === "pong") {
				lastPongAt = Date.now();
				return;
			}
			if (message.type === "ready") {
				lastPongAt = Date.now();
				return;
			}
			if (isRelayRequestMessage(message)) {
				void handleRelayRequest({
					socket,
					message,
					localUrl,
					publicUrl: session.publicUrl,
				});
			}
		});

		socket.addEventListener("close", () => {
			if (!stopped) fail("Guapocado dev relay connection closed");
		});
		socket.addEventListener("error", () => {
			if (!stopped) fail("Guapocado dev relay connection failed");
		});

		heartbeat = setInterval(() => {
			if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
				fail("Guapocado dev relay heartbeat failed");
				return;
			}
			sendJson(socket, { type: "ping", at: new Date().toISOString() });
		}, HEARTBEAT_INTERVAL_MS);

		announceRegistration(session, registration);
		consola.info(`Forwarding to ${localUrl}`);
		consola.info("Press Ctrl+C to stop.");

		process.once("SIGINT", () => stop(0));
		process.once("SIGTERM", () => stop(0));
	},
});
