import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { getGuap, getGuapCustomerId, guapocado } from "../index.js";

type FakeContext = {
	vars: Record<string, unknown>;
	set: (key: string, value: unknown) => void;
	get: (key: string) => unknown;
	json: ReturnType<typeof vi.fn>;
};

function makeContext(): FakeContext {
	const vars: Record<string, unknown> = {};
	return {
		vars,
		set: (key, value) => {
			vars[key] = value;
		},
		get: (key) => vars[key],
		json: vi.fn((body: unknown, status?: number) => ({ body, status })),
	};
}

// The middleware only touches set/get/json on the context.
const asCtx = (c: FakeContext) => c as unknown as Context;

describe("guapocado() Hono middleware", () => {
	it("attaches a client + customer scope and calls next", async () => {
		const c = makeContext();
		const next = vi.fn(async () => {});
		await guapocado({ apiKey: "sk_test_1", customerId: "org_1" })(asCtx(c), next);

		expect(next).toHaveBeenCalledOnce();
		const guap = getGuap(asCtx(c));
		expect(typeof guap.has).toBe("function");
		expect(getGuapCustomerId(asCtx(c))).toBe("org_1");
	});

	it("resolves apiKey / customerId from functions", async () => {
		const c = makeContext();
		await guapocado({
			apiKey: () => "sk_from_fn",
			customerId: async () => "org_fn",
		})(asCtx(c), async () => {});
		expect(getGuap(asCtx(c))).toBeDefined();
		expect(getGuapCustomerId(asCtx(c))).toBe("org_fn");
	});

	it("returns 500 and skips next when the apiKey is missing", async () => {
		const c = makeContext();
		const next = vi.fn(async () => {});
		await guapocado({ apiKey: () => undefined })(asCtx(c), next);

		expect(next).not.toHaveBeenCalled();
		expect(c.json).toHaveBeenCalledWith({ error: "Guapocado API key is required" }, 500);
	});

	it("uses onMissingApiKey when provided", async () => {
		const c = makeContext();
		const onMissingApiKey = vi.fn(() => new Response("custom", { status: 401 }));
		await guapocado({ apiKey: () => "", onMissingApiKey })(asCtx(c), async () => {});
		expect(onMissingApiKey).toHaveBeenCalledOnce();
		expect(c.json).not.toHaveBeenCalled();
	});

	it("does not set a customer scope when none resolves", async () => {
		const c = makeContext();
		await guapocado({ apiKey: "sk_test_1" })(asCtx(c), async () => {});
		expect(getGuapCustomerId(asCtx(c))).toBeUndefined();
	});
});
