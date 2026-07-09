import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createGuapocadoClient } from "../client.js";
import {
	type GuapCancelHookContext,
	type GuapDomainEventEnvelope,
	type GuapPlanChangeHookContext,
	type GuapPurchaseHookContext,
	type GuapStore,
	type GuapSubscribeHookContext,
	type GuapWebhookHooks,
	createGuapLocal,
	createMemoryGuapStore,
	verifyGuapocadoSignature,
} from "../local.js";

// ---------------------------------------------------------------------------
// Fixtures — verbatim shapes from the domain event catalog (spec §0.3).
// ---------------------------------------------------------------------------

function envelope(
	type: string,
	data: unknown,
	overrides: Partial<GuapDomainEventEnvelope> = {},
): GuapDomainEventEnvelope {
	return {
		id: overrides.id ?? `evt_${Math.random().toString(16).slice(2)}`,
		type,
		createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
		data,
		source: overrides.source ?? { provider: "guapocado" },
	};
}

const customerUpdated = (overrides: Partial<GuapDomainEventEnvelope> = {}) =>
	envelope(
		"customer.updated",
		{
			customer: {
				id: "cus_1",
				stripeCustomerId: "cus_stripe_1",
				name: "Ada Lovelace",
				email: "ada@example.com",
				metadata: JSON.stringify({ plan: "pro" }),
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		},
		overrides,
	);

const subscriptionUpdated = (
	status: string,
	planKey = "pro",
	overrides: Partial<GuapDomainEventEnvelope> = {},
) =>
	envelope(
		"subscription.updated",
		{
			subscription: {
				id: "sub_1",
				customerId: "cus_1",
				stripeSubscriptionId: "sub_stripe_1",
				planKey,
				status,
				currentPeriodStart: "2026-01-01T00:00:00.000Z",
				currentPeriodEnd: "2026-02-01T00:00:00.000Z",
				cancelAtPeriodEnd: false,
			},
		},
		overrides,
	);

const purchaseCompleted = (overrides: Partial<GuapDomainEventEnvelope> = {}) =>
	envelope(
		"purchase.completed",
		{
			purchase: {
				id: "pur_1",
				customerId: "cus_1",
				productKey: "credit-pack",
				stripeCheckoutSessionId: "cs_1",
				stripePaymentIntentId: "pi_1",
				status: "completed",
				amount: 1900,
				currency: "usd",
				quantity: 1,
				completedAt: "2026-01-01T00:00:00.000Z",
			},
			grants: [{ entitlementKey: "api-calls", grantType: "meter_credit", amount: 1000 }],
		},
		overrides,
	);

const purchaseUpdated = (overrides: Partial<GuapDomainEventEnvelope> = {}) =>
	envelope(
		"purchase.updated",
		{
			purchase: {
				id: "pur_1",
				customerId: "cus_1",
				productKey: "credit-pack",
				stripeCheckoutSessionId: "cs_1",
				stripePaymentIntentId: "pi_1",
				status: "refunded",
				amount: 1900,
				currency: "usd",
				quantity: 1,
				completedAt: "2026-01-01T00:00:00.000Z",
			},
		},
		overrides,
	);

const entitlementsUpdatedFromPurchase = (overrides: Partial<GuapDomainEventEnvelope> = {}) =>
	envelope(
		"entitlements.updated",
		{
			customerId: "cus_1",
			reason: "purchase.completed",
			purchaseId: "pur_1",
			productKey: "credit-pack",
			grants: [{ entitlementKey: "api-calls", grantType: "meter_credit", amount: 1000 }],
		},
		overrides,
	);

const invoiceUpdated = (overrides: Partial<GuapDomainEventEnvelope> = {}) =>
	envelope(
		"invoice.updated",
		{
			invoice: {
				id: "inv_1",
				customerId: "cus_1",
				stripeInvoiceId: "in_1",
				subscriptionId: "sub_1",
				status: "paid",
				amountDue: 4900,
				amountPaid: 4900,
				currency: "usd",
				periodStart: "2026-01-01T00:00:00.000Z",
				periodEnd: "2026-02-01T00:00:00.000Z",
				hostedInvoiceUrl: "https://invoice.example/1",
				pdfUrl: "https://invoice.example/1.pdf",
			},
		},
		overrides,
	);

async function signPayload(
	secret: string,
	body: string,
	timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${timestamp}.${body}`),
	);
	const hex = Array.from(new Uint8Array(mac))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `t=${timestamp},v1=${hex}`;
}

async function seededStore(secret: string): Promise<GuapStore> {
	const store = createMemoryGuapStore();
	await store.put("meta", "registration", {
		value: {
			id: "wh_1",
			url: "https://app.example.com/guap",
			events: "*",
			status: "active",
			signingSecret: secret,
		},
		sourceTs: 0,
		writtenAt: 0,
	});
	return store;
}

function postRequest(body: string, signature: string | null): Request {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (signature) headers["guapocado-signature"] = signature;
	return new Request("https://app.example.com/guap", { method: "POST", headers, body });
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe("project() — per-event projection", () => {
	it("projects customer.updated, parsing metadata leniently", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(customerUpdated());
		const record = await store.get("customers", "cus_1");
		expect(record?.value).toMatchObject({
			id: "cus_1",
			name: "Ada Lovelace",
			metadata: { plan: "pro" },
		});
	});

	it("falls back to the raw string when customer metadata is not valid JSON", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(
			customerUpdated({
				id: "evt_bad_meta",
			}),
		);
		// Overwrite with invalid metadata via a second, newer event.
		const bad = customerUpdated({ id: "evt_bad_meta_2", createdAt: "2026-01-02T00:00:00.000Z" });
		(bad.data as { customer: { metadata: unknown } }).customer.metadata = "not json";
		await local.project(bad);

		const record = await store.get("customers", "cus_1");
		expect((record?.value as { metadata: unknown }).metadata).toBe("not json");
	});

	it("projects subscription.updated and invalidates features/limits on a status transition", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await store.put("features", "cus_1:advanced-analytics", {
			value: true,
			sourceTs: 1,
			writtenAt: 1,
		});
		await store.put("limits", "cus_1:seats", { value: { limit: 5 }, sourceTs: 1, writtenAt: 1 });

		await local.project(
			subscriptionUpdated("active", "pro", { createdAt: "2026-01-01T00:00:00.000Z" }),
		);
		expect(await store.get("features", "cus_1:advanced-analytics")).not.toBeNull();

		await local.project(
			subscriptionUpdated("canceled", "pro", { createdAt: "2026-01-02T00:00:00.000Z" }),
		);
		expect(await store.get("features", "cus_1:advanced-analytics")).toBeNull();
		expect(await store.get("limits", "cus_1:seats")).toBeNull();
		expect((await store.get("subscriptions", "cus_1"))?.value).toMatchObject({
			status: "canceled",
		});
	});

	it("does not invalidate features/limits when the subscription status is unchanged", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		await store.put("features", "cus_1:x", { value: true, sourceTs: 1, writtenAt: 1 });

		await local.project(
			subscriptionUpdated("active", "pro", { createdAt: "2026-01-01T00:00:00.000Z" }),
		);
		await local.project(
			subscriptionUpdated("active", "pro", { createdAt: "2026-01-02T00:00:00.000Z" }),
		);

		expect(await store.get("features", "cus_1:x")).not.toBeNull();
	});

	it("projects purchase.completed and purchase.updated to the same purchases/<customerId>:<id> record", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(purchaseCompleted());
		expect((await store.get("purchases", "cus_1:pur_1"))?.value).toMatchObject({
			status: "completed",
		});

		await local.project(purchaseUpdated({ createdAt: "2026-01-02T00:00:00.000Z" }));
		expect((await store.get("purchases", "cus_1:pur_1"))?.value).toMatchObject({
			status: "refunded",
		});
	});

	it("projects entitlements.updated as invalidation only, across features/limits/usage", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		await store.put("features", "cus_1:x", { value: true, sourceTs: 1, writtenAt: 1 });
		await store.put("limits", "cus_1:seats", { value: { limit: 5 }, sourceTs: 1, writtenAt: 1 });
		await store.put("usage", "cus_1:api-calls", {
			value: { balance: 10 },
			sourceTs: 1,
			writtenAt: 1,
		});

		await local.project(entitlementsUpdatedFromPurchase());

		expect(await store.get("features", "cus_1:x")).toBeNull();
		expect(await store.get("limits", "cus_1:seats")).toBeNull();
		expect(await store.get("usage", "cus_1:api-calls")).toBeNull();
	});

	it("projects invoice.updated", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(invoiceUpdated());
		expect((await store.get("invoices", "cus_1:inv_1"))?.value).toMatchObject({
			status: "paid",
			amountPaid: 4900,
		});
	});

	it("tolerates unknown/future event types as a no-op", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await expect(local.project(envelope("something.new", { foo: 1 }))).resolves.toBeUndefined();
	});

	it("LWW: rejects a strictly-older event and accepts a tie", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(
			subscriptionUpdated("active", "pro", { createdAt: "2026-01-05T00:00:00.000Z" }),
		);
		// Older event arrives late — rejected.
		await local.project(
			subscriptionUpdated("past_due", "pro", { createdAt: "2026-01-01T00:00:00.000Z" }),
		);
		expect((await store.get("subscriptions", "cus_1"))?.value).toMatchObject({ status: "active" });

		// Tie (same createdAt) — favors the newer arrival, i.e. is written.
		await local.project(
			subscriptionUpdated("past_due", "pro", { createdAt: "2026-01-05T00:00:00.000Z" }),
		);
		expect((await store.get("subscriptions", "cus_1"))?.value).toMatchObject({
			status: "past_due",
		});
	});

	it("a malformed createdAt sources to timestamp 0, losing LWW against an existing, validly-timestamped record", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(
			subscriptionUpdated("active", "pro", { createdAt: "2026-01-01T00:00:00.000Z" }),
		);
		// A malformed createdAt must lose the conflict, not win it — Date.now()
		// fallback would let garbage input overwrite legitimate state.
		await local.project(subscriptionUpdated("canceled", "pro", { createdAt: "not-a-real-date" }));

		expect((await store.get("subscriptions", "cus_1"))?.value).toMatchObject({ status: "active" });
	});

	it("a malformed createdAt still performs the first write on an empty key", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });

		await local.project(subscriptionUpdated("active", "pro", { createdAt: "not-a-real-date" }));

		const record = await store.get("subscriptions", "cus_1");
		expect(record?.value).toMatchObject({ status: "active" });
		expect(record?.sourceTs).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Adapter: miss-through, true-up, staleness, fail-open, null caching
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status < 400,
		status,
		statusText: "OK",
		headers: new Headers(),
		json: async () => body,
	} as Response;
}

describe("adapter — miss-through + true-up", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn(async () => jsonResponse(true));
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("misses locally, falls back to the API, and true-ups the store", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const guap = createGuapocadoClient({
			apiKey: "sk_test",
			customerId: "cus_1",
			adapter: local.adapter,
		});

		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		const first = await guap.has("advanced-analytics");
		expect(first).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Second read is served locally — no second fetch.
		const second = await guap.has("advanced-analytics");
		expect(second).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("expires a local record once maxAgeMs has elapsed", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({
			apiKey: "sk_test",
			store,
			maxAgeMs: 10,
			webhook: { autoRegister: false },
		});
		const guap = createGuapocadoClient({
			apiKey: "sk_test",
			customerId: "cus_1",
			adapter: local.adapter,
		});

		fetchMock.mockResolvedValue(jsonResponse(true));
		await guap.has("advanced-analytics");
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await new Promise((resolve) => setTimeout(resolve, 20));
		await guap.has("advanced-analytics");
		expect(fetchMock).toHaveBeenCalledTimes(2); // stale local record => miss-through again
	});

	it("fails open when the store throws, routing the error through onError", async () => {
		const onError = vi.fn();
		const throwingStore: GuapStore = {
			get: async () => {
				throw new Error("store is down");
			},
			put: async () => {},
			delete: async () => {},
			listByPrefix: async () => [],
		};
		const local = createGuapLocal({
			apiKey: "sk_test",
			store: throwingStore,
			onError,
			webhook: { autoRegister: false },
		});
		const guap = createGuapocadoClient({
			apiKey: "sk_test",
			customerId: "cus_1",
			adapter: local.adapter,
		});

		fetchMock.mockResolvedValueOnce(jsonResponse(true));
		const value = await guap.has("advanced-analytics");
		expect(value).toBe(true); // degrades to plain API SDK, never blocks
		expect(onError).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ scope: "store" }),
		);
	});

	it("caches a null subscription true-up so free-tier customers don't hit the API forever", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const guap = createGuapocadoClient({
			apiKey: "sk_test",
			customerId: "cus_1",
			adapter: local.adapter,
		});

		fetchMock.mockResolvedValueOnce(jsonResponse({ subscriptions: [] }));
		const first = await guap.subscription.current();
		expect(first).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const second = await guap.subscription.current();
		expect(second).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1); // served from the cached null marker
	});

	it("context always misses locally but its true-up seeds features/usage/limits/plans/subscription", async () => {
		const store = createMemoryGuapStore();
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const guap = createGuapocadoClient({
			apiKey: "sk_test",
			customerId: "cus_1",
			adapter: local.adapter,
		});

		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				customerId: "cus_1",
				customer: { id: "cus_1", name: "Ada" },
				features: { "advanced-analytics": true },
				usage: {
					"api-calls": {
						balance: 10,
						included: 10,
						consumed: 0,
						overage: 0,
						overageAllowed: false,
						overageEnabled: false,
						resets: null,
					},
				},
				limits: {
					seats: {
						limit: 5,
						included: 5,
						purchased: 0,
						expansionAllowed: false,
						autoExpansionEnabled: false,
					},
				},
				plans: [],
				subscription: null,
			}),
		);
		await guap.context({});

		expect((await store.get("features", "cus_1:advanced-analytics"))?.value).toBe(true);
		expect(await store.get("usage", "cus_1:api-calls")).not.toBeNull();
		expect(await store.get("limits", "cus_1:seats")).not.toBeNull();
		expect((await store.get("plans", "all"))?.value).toEqual([]);
		expect((await store.get("subscriptions", "cus_1"))?.value).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

describe("verifyGuapocadoSignature", () => {
	const secret = "whsec_test";
	const payload = JSON.stringify({ id: "evt_1" });

	it("accepts a validly signed payload", async () => {
		const signature = await signPayload(secret, payload);
		expect(await verifyGuapocadoSignature({ payload, secret, signature })).toBe(true);
	});

	it("rejects a bad signature", async () => {
		const signature = await signPayload("wrong-secret", payload);
		expect(await verifyGuapocadoSignature({ payload, secret, signature })).toBe(false);
	});

	it("rejects a missing signature", async () => {
		expect(await verifyGuapocadoSignature({ payload, secret, signature: null })).toBe(false);
		expect(await verifyGuapocadoSignature({ payload, secret, signature: undefined })).toBe(false);
	});

	it("rejects a malformed signature header", async () => {
		expect(await verifyGuapocadoSignature({ payload, secret, signature: "not-a-signature" })).toBe(
			false,
		);
		expect(
			await verifyGuapocadoSignature({ payload, secret, signature: "t=abc,v1=deadbeef" }),
		).toBe(false);
	});

	it("rejects a timestamp outside the tolerance window", async () => {
		const old = Math.floor(Date.now() / 1000) - 1000;
		const signature = await signPayload(secret, payload, old);
		expect(await verifyGuapocadoSignature({ payload, secret, signature })).toBe(false);
		expect(
			await verifyGuapocadoSignature({ payload, secret, signature, toleranceSeconds: 2000 }),
		).toBe(true);
	});

	it("verifies against the exact raw body, not a re-canonicalized one", async () => {
		const raw = '{"b":2,"a":1}'; // deliberately out of canonical key order
		const signature = await signPayload(secret, raw);
		expect(await verifyGuapocadoSignature({ payload: raw, secret, signature })).toBe(true);
		expect(await verifyGuapocadoSignature({ payload: '{"a":1,"b":2}', secret, signature })).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("handler — webhook ingest", () => {
	const secret = "whsec_test";

	it("returns 401 for an invalid signature", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const body = JSON.stringify(customerUpdated());
		const res = await local.handler()(postRequest(body, "t=1,v1=deadbeef"));
		expect(res.status).toBe(401);
	});

	it("returns 401 for a missing signature", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const res = await local.handler()(postRequest(JSON.stringify(customerUpdated()), null));
		expect(res.status).toBe(401);
	});

	it("returns 400 for malformed JSON", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const body = "{not json";
		const signature = await signPayload(secret, body);
		const res = await local.handler()(postRequest(body, signature));
		expect(res.status).toBe(400);
	});

	it("returns 200 and dedup:true on a redelivered event id", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const body = JSON.stringify(customerUpdated({ id: "evt_dupe" }));
		const signature = await signPayload(secret, body);

		const first = await local.handler()(postRequest(body, signature));
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ received: true });

		const second = await local.handler()(postRequest(body, signature));
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ received: true, deduplicated: true });
	});

	it("returns 200 and ignored:true for a syntactically valid but unknown event type", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const body = JSON.stringify(envelope("something.new", { foo: 1 }));
		const signature = await signPayload(secret, body);
		const res = await local.handler()(postRequest(body, signature));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: true, ignored: true });
	});

	it("returns 500 when projection throws, and never re-throws", async () => {
		const onError = vi.fn();
		const store: GuapStore = {
			get: async (collection) =>
				collection === "meta"
					? {
							value: {
								id: "wh_1",
								url: "https://x",
								events: "*",
								status: "active",
								signingSecret: secret,
							},
							sourceTs: 0,
							writtenAt: 0,
						}
					: null,
			put: async (collection) => {
				if (collection === "customers") throw new Error("write failed");
			},
			delete: async () => {},
			listByPrefix: async () => [],
		};
		const local = createGuapLocal({
			apiKey: "sk_test",
			store,
			onError,
			webhook: { autoRegister: false },
		});
		const body = JSON.stringify(customerUpdated());
		const signature = await signPayload(secret, body);

		let response: Response | undefined;
		await expect(
			(async () => {
				response = await local.handler()(postRequest(body, signature));
			})(),
		).resolves.toBeUndefined();
		expect(response?.status).toBe(500);
		expect(onError).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ scope: "store" }),
		);
	});

	it("returns 500 when the dedup marker write fails, and does not treat a subsequent successful delivery as a duplicate", async () => {
		const onError = vi.fn();
		const memory = createMemoryGuapStore();
		let failNextEventsPut = true;
		const store: GuapStore = {
			get: (collection, id) => memory.get(collection, id),
			put: async (collection, id, record) => {
				if (collection === "events" && failNextEventsPut) {
					failNextEventsPut = false;
					throw new Error("marker write failed");
				}
				return memory.put(collection, id, record);
			},
			delete: (collection, id) => memory.delete(collection, id),
			listByPrefix: (collection, idPrefix) => memory.listByPrefix(collection, idPrefix),
		};
		await store.put("meta", "registration", {
			value: {
				id: "wh_1",
				url: "https://app.example.com/guap",
				events: "*",
				status: "active",
				signingSecret: secret,
			},
			sourceTs: 0,
			writtenAt: 0,
		});

		const local = createGuapLocal({
			apiKey: "sk_test",
			store,
			onError,
			webhook: { autoRegister: false },
		});
		const onCustomerUpdated = vi.fn();
		const body = JSON.stringify(customerUpdated({ id: "evt_marker_fail" }));
		const signature = await signPayload(secret, body);

		const first = await local.handler({ onCustomerUpdated })(postRequest(body, signature));
		expect(first.status).toBe(500);
		expect(onError).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ scope: "store", detail: "dedup marker write" }),
		);
		expect(onCustomerUpdated).toHaveBeenCalledTimes(1); // hook already ran before the marker write failed
		expect(await store.get("events", "evt_marker_fail")).toBeNull(); // marker never landed

		// The platform retries; this redelivery is NOT deduplicated (no marker was
		// ever written), the hook re-fires, and the delivery now succeeds.
		const second = await local.handler({ onCustomerUpdated })(postRequest(body, signature));
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ received: true });
		expect(onCustomerUpdated).toHaveBeenCalledTimes(2);
	});

	it("returns 405 for methods other than GET/POST", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const res = await local.handler()(
			new Request("https://app.example.com/guap", { method: "DELETE" }),
		);
		expect(res.status).toBe(405);
	});

	it("GET returns registration status", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const res = await local.handler()(
			new Request("https://app.example.com/guap", { method: "GET" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, registered: true, status: "active" });
	});
});

// ---------------------------------------------------------------------------
// Registration URL resolution — publicUrl is required for auto-registration
// ---------------------------------------------------------------------------

describe("registration URL resolution", () => {
	it("POST: skips auto-registration and reports onError when no publicUrl is configured", async () => {
		const store = createMemoryGuapStore();
		const onError = vi.fn();
		const local = createGuapLocal({ apiKey: "sk_test", store, onError }); // autoRegister defaults true; no webhook.publicUrl
		const body = JSON.stringify(customerUpdated());
		const res = await local.handler()(postRequest(body, null));

		// No signing secret was ever obtained, so the delivery can't verify.
		expect(res.status).toBe(401);
		expect(onError).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				scope: "registration",
				detail: "no publicUrl configured — set webhook.publicUrl to enable auto-registration",
			}),
		);
		// Never registered — in particular, never registered from request.url.
		expect(await store.get("meta", "registration")).toBeNull();
	});

	it("GET: skips auto-registration, reports onError, and surfaces request.url only as a suggestedUrl hint", async () => {
		const store = createMemoryGuapStore();
		const onError = vi.fn();
		const local = createGuapLocal({ apiKey: "sk_test", store, onError });
		const res = await local.handler()(
			new Request("https://app.example.com/guap", { method: "GET" }),
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ok: true,
			registered: false,
			suggestedUrl: "https://app.example.com/guap",
		});
		expect(onError).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				scope: "registration",
				detail: "no publicUrl configured — set webhook.publicUrl to enable auto-registration",
			}),
		);
		expect(await store.get("meta", "registration")).toBeNull();
	});

	describe("trustForwardedHost", () => {
		let fetchMock: ReturnType<typeof vi.fn>;
		beforeEach(() => {
			fetchMock = vi.fn(async () =>
				jsonResponse({
					id: "wh_forwarded",
					status: "pending_approval",
					url: "https://forwarded.example.com/guap",
					events: "*",
					signingSecret: "whsec_forwarded",
				}),
			);
			vi.stubGlobal("fetch", fetchMock);
		});
		afterEach(() => vi.unstubAllGlobals());

		it("honors the x-guapocado-public-url header when trustForwardedHost is true", async () => {
			const store = createMemoryGuapStore();
			const local = createGuapLocal({
				apiKey: "sk_test",
				store,
				webhook: { trustForwardedHost: true },
			});
			const request = new Request("https://app.example.com/guap", {
				method: "GET",
				headers: { "x-guapocado-public-url": "https://forwarded.example.com/guap" },
			});

			const res = await local.handler()(request);
			expect(res.status).toBe(200);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
			const requestedBody = JSON.parse(init.body as string);
			expect(requestedBody.url).toBe("https://forwarded.example.com/guap"); // not request.url
			expect(await res.json()).toMatchObject({
				ok: true,
				registered: true,
				status: "pending_approval",
			});
		});

		it("ignores the header (and skips registration) when trustForwardedHost is not set", async () => {
			const store = createMemoryGuapStore();
			const onError = vi.fn();
			const local = createGuapLocal({ apiKey: "sk_test", store, onError }); // trustForwardedHost defaults false
			const request = new Request("https://app.example.com/guap", {
				method: "GET",
				headers: { "x-guapocado-public-url": "https://forwarded.example.com/guap" },
			});

			const res = await local.handler()(request);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(await res.json()).toMatchObject({ ok: true, registered: false });
			expect(onError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({ scope: "registration" }),
			);
		});
	});
});

// ---------------------------------------------------------------------------
// Webhook hooks (spec §8)
// ---------------------------------------------------------------------------

describe("webhook hooks", () => {
	const secret = "whsec_test";

	async function post(
		local: ReturnType<typeof createGuapLocal>,
		body: unknown,
		hooks?: GuapWebhookHooks,
	) {
		const json = JSON.stringify(body);
		const signature = await signPayload(secret, json);
		return local.handler(hooks)(postRequest(json, signature));
	}

	it("fires the raw per-event hook for a known type", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onCustomerUpdated = vi.fn();
		const res = await post(local, customerUpdated(), { onCustomerUpdated });
		expect(res.status).toBe(200);
		expect(onCustomerUpdated).toHaveBeenCalledTimes(1);
		const ctx = onCustomerUpdated.mock.calls[0]?.[0];
		expect(ctx.customerId).toBe("cus_1");
		expect(ctx.data.customer.id).toBe("cus_1");
		expect(ctx.client).toBeDefined();
	});

	it("onEvent fires for every event, including unknown types", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onEvent = vi.fn();
		await post(local, customerUpdated(), { onEvent });
		await post(local, envelope("something.new", { foo: 1 }), { onEvent });
		expect(onEvent).toHaveBeenCalledTimes(2);
	});

	it("onSubscribe fires when a customer transitions from no subscription into active", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onSubscribe = vi.fn();
		await post(local, subscriptionUpdated("active"), { onSubscribe });
		expect(onSubscribe).toHaveBeenCalledTimes(1);
		const ctx: GuapSubscribeHookContext = onSubscribe.mock.calls[0]?.[0];
		expect(ctx.previous).toBeNull();
		expect(ctx.subscription.status).toBe("active");
	});

	it("onSubscribe does not fire on a second active event (already active)", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onSubscribe = vi.fn();
		await post(
			local,
			subscriptionUpdated("active", "pro", { id: "evt_a", createdAt: "2026-01-01T00:00:00.000Z" }),
			{
				onSubscribe,
			},
		);
		await post(
			local,
			subscriptionUpdated("active", "pro", { id: "evt_b", createdAt: "2026-01-02T00:00:00.000Z" }),
			{
				onSubscribe,
			},
		);
		expect(onSubscribe).toHaveBeenCalledTimes(1);
	});

	it("onCancel fires on a transition into canceled, including with no previous record", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onCancel = vi.fn();
		await post(local, subscriptionUpdated("canceled"), { onCancel });
		expect(onCancel).toHaveBeenCalledTimes(1);
		const ctx: GuapCancelHookContext = onCancel.mock.calls[0]?.[0];
		expect(ctx.previous).toBeNull();
	});

	it("onCancel does not re-fire once already canceled", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onCancel = vi.fn();
		await post(
			local,
			subscriptionUpdated("canceled", "pro", {
				id: "evt_a",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			{
				onCancel,
			},
		);
		await post(
			local,
			subscriptionUpdated("canceled", "pro", {
				id: "evt_b",
				createdAt: "2026-01-02T00:00:00.000Z",
			}),
			{
				onCancel,
			},
		);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("onPlanChange fires only when a previous record exists and planKey differs", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onPlanChange = vi.fn();

		// First event ever: no previous record, so no plan-change hook even though there's technically a "plan".
		await post(
			local,
			subscriptionUpdated("active", "starter", {
				id: "evt_a",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			{
				onPlanChange,
			},
		);
		expect(onPlanChange).not.toHaveBeenCalled();

		await post(
			local,
			subscriptionUpdated("active", "pro", { id: "evt_b", createdAt: "2026-01-02T00:00:00.000Z" }),
			{
				onPlanChange,
			},
		);
		expect(onPlanChange).toHaveBeenCalledTimes(1);
		const ctx: GuapPlanChangeHookContext = onPlanChange.mock.calls[0]?.[0];
		expect(ctx.previous.planKey).toBe("starter");
		expect(ctx.subscription.planKey).toBe("pro");
	});

	it("onPurchase fires as an alias for purchase.completed, with grants attached", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onPurchase = vi.fn();
		await post(local, purchaseCompleted(), { onPurchase });
		expect(onPurchase).toHaveBeenCalledTimes(1);
		const ctx: GuapPurchaseHookContext = onPurchase.mock.calls[0]?.[0];
		expect(ctx.purchase.id).toBe("pur_1");
		expect(ctx.grants).toHaveLength(1);
	});

	it("an LWW-rejected subscription event fires the raw hook + onEvent but not semantic hooks, and does not invalidate features/limits (stale canceled-after-active)", async () => {
		const store = await seededStore(secret);
		await store.put("features", "cus_1:advanced-analytics", {
			value: true,
			sourceTs: 1,
			writtenAt: 1,
		});
		await store.put("limits", "cus_1:seats", { value: { limit: 5 }, sourceTs: 1, writtenAt: 1 });

		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onSubscriptionUpdated = vi.fn();
		const onEvent = vi.fn();
		const onSubscribe = vi.fn();
		const onCancel = vi.fn();
		const hooks = { onSubscriptionUpdated, onEvent, onSubscribe, onCancel };

		// Newer "active" event arrives first and is accepted — customer subscribes.
		await post(
			local,
			subscriptionUpdated("active", "pro", {
				id: "evt_active",
				createdAt: "2026-01-05T00:00:00.000Z",
			}),
			hooks,
		);
		expect(onSubscribe).toHaveBeenCalledTimes(1);
		onSubscriptionUpdated.mockClear();
		onEvent.mockClear();

		// A delayed "canceled" event with an OLDER createdAt arrives late — LWW
		// rejects the write (this is the exact stale-canceled-after-active scenario).
		const res = await post(
			local,
			subscriptionUpdated("canceled", "pro", {
				id: "evt_stale_cancel",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			hooks,
		);
		expect(res.status).toBe(200);

		// Store state is unaffected by the rejected write.
		expect((await store.get("subscriptions", "cus_1"))?.value).toMatchObject({ status: "active" });
		expect(await store.get("features", "cus_1:advanced-analytics")).not.toBeNull();
		expect(await store.get("limits", "cus_1:seats")).not.toBeNull();

		// Raw per-type hook and onEvent are the at-least-once event log — they
		// still fire for this authentic (verified, non-deduplicated) delivery.
		expect(onSubscriptionUpdated).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledTimes(1);

		// Semantic hooks report a state transition that never happened here —
		// they must not fire for a delivery LWW rejected.
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("a throwing hook causes a 500, does not write the dedup marker, and re-fires on redelivery", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onCustomerUpdated = vi
			.fn()
			.mockRejectedValueOnce(new Error("hook failed"))
			.mockResolvedValueOnce(undefined);
		const body = customerUpdated({ id: "evt_hook_retry" });

		const first = await post(local, body, { onCustomerUpdated });
		expect(first.status).toBe(500);
		expect(onCustomerUpdated).toHaveBeenCalledTimes(1);
		expect(await store.get("events", "evt_hook_retry")).toBeNull(); // marker not written

		const second = await post(local, body, { onCustomerUpdated });
		expect(second.status).toBe(200);
		expect(onCustomerUpdated).toHaveBeenCalledTimes(2); // at-least-once re-fire
	});

	it("deduplicated redeliveries never re-fire hooks", async () => {
		const store = await seededStore(secret);
		const local = createGuapLocal({ apiKey: "sk_test", store, webhook: { autoRegister: false } });
		const onCustomerUpdated = vi.fn();
		const body = customerUpdated({ id: "evt_no_redup_hooks" });

		await post(local, body, { onCustomerUpdated });
		await post(local, body, { onCustomerUpdated });
		expect(onCustomerUpdated).toHaveBeenCalledTimes(1);
	});

	it("constructor-level hooks apply, and factory-level hooks override per key", async () => {
		const store = await seededStore(secret);
		const constructorHook = vi.fn();
		const factoryHook = vi.fn();
		const local = createGuapLocal({
			apiKey: "sk_test",
			store,
			webhook: { autoRegister: false },
			hooks: { onCustomerUpdated: constructorHook },
		});

		// No factory override — constructor hook still runs.
		await post(local, customerUpdated({ id: "evt_c1" }));
		expect(constructorHook).toHaveBeenCalledTimes(1);

		// Factory override replaces onCustomerUpdated only.
		await post(local, customerUpdated({ id: "evt_c2" }), { onCustomerUpdated: factoryHook });
		expect(factoryHook).toHaveBeenCalledTimes(1);
		expect(constructorHook).toHaveBeenCalledTimes(1); // not called again
	});
});

// ---------------------------------------------------------------------------
// Type-level regression guard (enforced by `tsc`): inline lambdas passed to
// `handler()`/`createGuapLocal({ hooks })` must infer their ctx type with zero
// annotations. This test performs no runtime assertions — it exists to fail
// `pnpm typecheck` if hook inference ever collapses.
// ---------------------------------------------------------------------------
describe("hook context type inference", () => {
	it("infers ctx types for inline lambdas with zero annotations", () => {
		const local = createGuapLocal({ apiKey: "sk_test", webhook: { autoRegister: false } });

		local.handler({
			onCancel: (ctx) => {
				expectTypeOf(ctx.customerId).toEqualTypeOf<string | null>();
				expectTypeOf(ctx.previous).toEqualTypeOf<GuapCancelHookContext["previous"]>();
				expectTypeOf(ctx.subscription.planKey).toBeString();
			},
			onPlanChange: (ctx) => {
				expectTypeOf(ctx.previous.planKey).toBeString(); // non-nullable for onPlanChange
			},
			onPurchase: (ctx) => {
				expectTypeOf(ctx.grants).items.toEqualTypeOf<GuapPurchaseHookContext["grants"][number]>();
				expectTypeOf(ctx.purchase.id).toBeString();
			},
			onEvent: (ctx) => {
				expectTypeOf(ctx.data).toBeUnknown();
			},
			onCustomerUpdated: (ctx) => {
				expectTypeOf(ctx.data.customer.id).toBeString();
			},
		});
	});
});
