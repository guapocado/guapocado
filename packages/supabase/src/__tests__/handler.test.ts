import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuapocadoSupabaseHandler } from "../index.js";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
	const status = init.status ?? 200;
	return {
		ok: status < 400,
		status,
		statusText: "OK",
		headers: new Headers(),
		json: async () => body,
	} as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("createGuapocadoSupabaseHandler", () => {
	it("answers an OPTIONS preflight with 204", async () => {
		const handler = createGuapocadoSupabaseHandler({ cors: true });
		const res = await handler(new Request("https://fn/features/x", { method: "OPTIONS" }));
		expect(res.status).toBe(204);
	});

	it("serves a health check without a key", async () => {
		const handler = createGuapocadoSupabaseHandler();
		const res = await handler(new Request("https://fn/health"));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ status: "ok", integration: "supabase" });
	});

	it("500s when no API key is configured", async () => {
		const handler = createGuapocadoSupabaseHandler();
		const res = await handler(new Request("https://fn/features/analytics"));
		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/API_KEY/) });
	});

	it("checks a feature through the SDK", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(true)),
		);
		const handler = createGuapocadoSupabaseHandler({ apiKey: "sk", customerId: "org_1" });
		const res = await handler(new Request("https://fn/features/analytics"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ key: "analytics", hasAccess: true });
	});

	it("404s a known resource with an unsupported method", async () => {
		const handler = createGuapocadoSupabaseHandler({ apiKey: "sk", customerId: "org_1" });
		const res = await handler(new Request("https://fn/features/analytics", { method: "DELETE" }));
		expect(res.status).toBe(404);
	});

	it("maps a GuapocadoError status from the SDK", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ error: "no access" }, { status: 402 })),
		);
		const handler = createGuapocadoSupabaseHandler({ apiKey: "sk", customerId: "org_1" });
		const res = await handler(new Request("https://fn/features/analytics"));
		expect(res.status).toBe(402);
	});
});
