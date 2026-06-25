import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type GuapAdapter,
	GuapocadoAuthError,
	GuapocadoRateLimitError,
	GuapocadoValidationError,
	createGuapocadoClient,
	createReadOnlyGuapocadoClient,
} from "../index.js";

function jsonResponse(
	body: unknown,
	init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
): Response {
	const status = init.status ?? 200;
	return {
		ok: status < 400,
		status,
		statusText: init.statusText ?? "OK",
		headers: new Headers(init.headers ?? {}),
		json: async () => body,
	} as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	// `mock.calls` records args regardless of `mockResolvedValueOnce`, so we read
	// request shape from there.
	fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const reqUrl = (i = 0): string => fetchMock.mock.calls[i]?.[0] as string;
const reqInit = (i = 0): RequestInit | undefined =>
	fetchMock.mock.calls[i]?.[1] as RequestInit | undefined;

function lastBody(): unknown {
	const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
	const body = init?.body;
	return typeof body === "string" ? JSON.parse(body) : undefined;
}

describe("construction", () => {
	it("requires an apiKey", () => {
		expect(() => createGuapocadoClient({ apiKey: "" })).toThrow(GuapocadoValidationError);
		expect(() => createReadOnlyGuapocadoClient({ apiKey: "" })).toThrow(GuapocadoValidationError);
	});
});

describe("request shaping", () => {
	const guap = () => createGuapocadoClient({ apiKey: "sk_test_1", customerId: "org_1" });

	it("sends the key + content-type headers and the default base URL", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		await guap().has("analytics");
		const url = reqUrl(0);
		const init = reqInit(0);
		expect(url).toBe("https://api.guapocado.dev/v1/entitlements/analytics/has?customerId=org_1");
		expect(init?.method ?? "GET").toBe("GET"); // GETs rely on fetch's default method
		const headers = init?.headers as Record<string, string>;
		expect(headers["x-guapocado-key"]).toBe("sk_test_1");
		expect(headers["content-type"]).toBe("application/json");
	});

	it("honors a custom apiUrl and url-encodes keys", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		const client = createGuapocadoClient({
			apiKey: "k",
			customerId: "org_1",
			apiUrl: "https://edge.example.com",
		});
		await client.has("ai.summary");
		expect(reqUrl(0)).toBe(
			"https://edge.example.com/v1/entitlements/ai.summary/has?customerId=org_1",
		);
	});

	it("uses the per-call customerId override", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		await guap().has("analytics", { customerId: "org_2" });
		expect(reqUrl(0)).toContain("customerId=org_2");
	});

	it("posts consume with amount and (optionally) an idempotency key", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ balance: 9 }));
		const client = guap();
		await client.usage.consume("api-calls", 1);
		expect(reqInit(0)?.method).toBe("POST");
		expect(lastBody()).toEqual({ customerId: "org_1", amount: 1 });

		await client.usage.consume("api-calls", 5, { idempotencyKey: "req_1" });
		expect(lastBody()).toEqual({ customerId: "org_1", amount: 5, idempotencyKey: "req_1" });
	});
});

describe("input validation (before any request)", () => {
	const guap = createGuapocadoClient({ apiKey: "k", customerId: "org_1" });

	// Some methods validate synchronously (throw) and others are async (reject);
	// this normalizes both to a rejection so the assertion is uniform.
	const expectValidation = (fn: () => unknown) =>
		expect(Promise.resolve().then(fn)).rejects.toBeInstanceOf(GuapocadoValidationError);

	it("rejects empty keys", async () => {
		await expectValidation(() => guap.has(""));
		await expectValidation(() => guap.usage.balance("  "));
	});

	it("rejects non-positive / non-integer consume amounts", async () => {
		await expectValidation(() => guap.usage.consume("k", 0));
		await expectValidation(() => guap.usage.consume("k", -1));
		await expectValidation(() => guap.usage.consume("k", 1.5));
	});

	it("requires a resolvable customerId", async () => {
		const noCustomer = createGuapocadoClient({ apiKey: "k" });
		await expectValidation(() => noCustomer.has("analytics"));
	});

	it("validates checkout input", async () => {
		await expectValidation(() =>
			guap.checkout.create({ successUrl: "", cancelUrl: "", productKey: "" }),
		);
	});

	it("does not call fetch when validation fails", async () => {
		await Promise.resolve()
			.then(() => guap.has(""))
			.catch(() => {});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("error mapping", () => {
	const guap = () => createGuapocadoClient({ apiKey: "k", customerId: "org_1" });

	it("maps 401 to GuapocadoAuthError with requestId", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ error: "bad key" }, { status: 401, headers: { "x-request-id": "req_9" } }),
		);
		const error = await guap()
			.has("a")
			.catch((e) => e);
		expect(error).toBeInstanceOf(GuapocadoAuthError);
		expect(error.status).toBe(401);
		expect(error.message).toBe("bad key");
		expect(error.requestId).toBe("req_9");
	});

	it("maps 429 to GuapocadoRateLimitError with retryAfter", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ error: "slow down" }, { status: 429, headers: { "retry-after": "30" } }),
		);
		const error = await guap()
			.has("a")
			.catch((e) => e);
		expect(error).toBeInstanceOf(GuapocadoRateLimitError);
		expect(error.retryAfter).toBe(30);
	});

	it("maps other non-2xx to GuapocadoError", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, { status: 500 }));
		await expect(guap().has("a")).rejects.toMatchObject({ status: 500, message: "boom" });
	});

	it("falls back to statusText when the body has no error", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 503, statusText: "Unavailable" }));
		await expect(guap().has("a")).rejects.toMatchObject({ message: "Unavailable" });
	});
});

describe("contracts", () => {
	const guap = () => createGuapocadoClient({ apiKey: "k", customerId: "org_1" });

	it("get returns the contract", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ contract: { id: "ctr_1" } }));
		const contract = await guap().contracts.get();
		expect(reqUrl(0)).toBe("https://api.guapocado.dev/v1/contracts/org_1");
		expect(contract).toEqual({ id: "ctr_1" });
	});

	it("get returns null on 404", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }));
		expect(await guap().contracts.get()).toBeNull();
	});

	it("set sends a PUT and returns the contract", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ contract: { id: "ctr_2" } }));
		const contract = await guap().contracts.set({ priceAmount: 200000, priceInterval: "month" });
		expect(reqInit(0)?.method).toBe("PUT");
		expect(lastBody()).toEqual({ priceAmount: 200000, priceInterval: "month" });
		expect(contract).toEqual({ id: "ctr_2" });
	});

	it("delete sends a DELETE", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
		expect(await guap().contracts.delete()).toEqual({ deleted: true });
		expect(reqInit(0)?.method).toBe("DELETE");
	});
});

describe("audit", () => {
	it("builds query params from the filter", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ logs: [], hasMore: false }));
		const guap = createGuapocadoClient({ apiKey: "k", customerId: "org_1" });
		await guap.audit.list({ action: "usage.consume", resourceType: "meter", limit: 10 });
		const url = new URL(reqUrl(0));
		expect(url.pathname).toBe("/v1/audit");
		expect(url.searchParams.get("action")).toBe("usage.consume");
		expect(url.searchParams.get("resourceType")).toBe("meter");
		expect(url.searchParams.get("limit")).toBe("10");
	});

	it("omits the query string with no filter", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ logs: [], hasMore: false }));
		const guap = createGuapocadoClient({ apiKey: "k", customerId: "org_1" });
		await guap.audit.list();
		expect(reqUrl(0)).toBe("https://api.guapocado.dev/v1/audit");
	});
});

describe("read-model adapter", () => {
	it("reads local first and skips the API on a hit", async () => {
		const adapter = {
			has: async () => ({ found: true, value: true }),
			trueUp: vi.fn(),
		} as unknown as GuapAdapter;
		const guap = createGuapocadoClient({ apiKey: "k", customerId: "org_1", adapter });
		expect(await guap.has("analytics")).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls back to the API on a miss and trues up", async () => {
		const trueUp = vi.fn();
		const adapter = {
			has: async () => ({ found: false, value: false }),
			trueUp,
		} as unknown as GuapAdapter;
		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		const guap = createGuapocadoClient({ apiKey: "k", customerId: "org_1", adapter });
		expect(await guap.has("analytics")).toBe(true);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(trueUp).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "has",
				customerId: "org_1",
				key: "analytics",
				value: true,
			}),
		);
	});
});

describe("read-only client", () => {
	it("exposes only safe reads", () => {
		const ro = createReadOnlyGuapocadoClient({ apiKey: "ck_test_1", customerId: "org_1" });
		expect(typeof ro.has).toBe("function");
		expect(typeof ro.limit).toBe("function");
		expect(typeof ro.usage.balance).toBe("function");
		expect("consume" in ro.usage).toBe(false);
	});
});
