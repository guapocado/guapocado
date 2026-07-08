import type { GuapLocal } from "@guapocado/sdk";
import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { guapLocalHandler } from "../index.js";

function makeContext(request: Request): Context {
	return { req: { raw: request } } as unknown as Context;
}

describe("guapLocalHandler()", () => {
	it("adapts local.handler() into a Hono route handler, forwarding the raw request", async () => {
		const response = new Response(null, { status: 200 });
		const requestHandler = vi.fn(async () => response);
		const local = { handler: vi.fn(() => requestHandler) } as unknown as GuapLocal;

		const request = new Request("https://app.example.com/guap", { method: "GET" });
		const result = await guapLocalHandler(local)(makeContext(request));

		expect(local.handler).toHaveBeenCalledWith(undefined);
		expect(requestHandler).toHaveBeenCalledWith(request);
		expect(result).toBe(response);
	});

	it("forwards hooks through to local.handler(hooks)", async () => {
		const requestHandler = vi.fn(async () => new Response(null, { status: 200 }));
		const local = { handler: vi.fn(() => requestHandler) } as unknown as GuapLocal;
		const hooks = { onCancel: vi.fn() };

		await guapLocalHandler(local, hooks)(makeContext(new Request("https://app.example.com/guap")));
		expect(local.handler).toHaveBeenCalledWith(hooks);
	});
});
