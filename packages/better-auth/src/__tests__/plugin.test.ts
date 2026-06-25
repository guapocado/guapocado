import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
	type AuthClientResult,
	type GuapocadoCheckout,
	type GuapocadoContext,
	guapocadoClient,
} from "../client.js";
import { guapocado } from "../index.js";

// Type-level regression guard (enforced by `tsc`): if client-action inference
// ever collapses again (e.g. via better-auth version skew), this fails to compile.
describe("client action types", () => {
	it("resolve to the { data, error } envelope", () => {
		const actions = guapocadoClient().getActions((async () => ({})) as never);
		expectTypeOf(actions.guapocado.context).returns.resolves.toEqualTypeOf<
			AuthClientResult<GuapocadoContext>
		>();
		expectTypeOf(actions.guapocado.checkout.create).returns.resolves.toEqualTypeOf<
			AuthClientResult<GuapocadoCheckout>
		>();
	});
});

describe("server plugin schema", () => {
	const plugin = guapocado({ apiKey: "k", customerId: "user" });

	it("has the guapocado id", () => {
		expect(plugin.id).toBe("guapocado");
	});

	// Regression guard: Better Auth auto-adds an `id` primary key, so declaring our
	// own `id` makes `better-auth generate` emit a duplicate-id Drizzle table.
	it("does NOT declare its own id on the webhook tables", () => {
		expect("id" in plugin.schema.guapocadoWebhookEndpoint.fields).toBe(false);
		expect("id" in plugin.schema.guapocadoWebhookEvent.fields).toBe(false);
	});

	it("declares the expected non-id fields", () => {
		expect(Object.keys(plugin.schema.guapocadoWebhookEndpoint.fields)).toEqual([
			"url",
			"events",
			"status",
			"signingSecret",
			"createdAt",
			"updatedAt",
		]);
	});
});

describe("client plugin actions return { data, error }", () => {
	type FakeFetch = (
		path: string,
		options?: { method?: string; body?: unknown },
	) => Promise<unknown>;

	it("passes through the Better Auth envelope", async () => {
		const $fetch = vi.fn<FakeFetch>(async () => ({ data: { customerId: "org_1" }, error: null }));
		const actions = guapocadoClient().getActions($fetch as never);
		const result = await actions.guapocado.context({});
		expect($fetch).toHaveBeenCalledWith("/guapocado/context", { method: "POST", body: {} });
		expect(result).toEqual({ data: { customerId: "org_1" }, error: null });
	});

	it("surfaces errors as { error } rather than throwing", async () => {
		const $fetch = vi.fn<FakeFetch>(async () => ({
			data: null,
			error: { message: "nope", status: 400, statusText: "Bad Request" },
		}));
		const actions = guapocadoClient().getActions($fetch as never);
		const result = (await actions.guapocado.has("x", { customerId: "org_1" })) as {
			error: { message: string };
		};
		expect(result.error.message).toBe("nope");
	});

	it("wraps a non-envelope response into { data, error: null }", async () => {
		const $fetch = vi.fn<FakeFetch>(async () => ({ plans: [] }));
		const actions = guapocadoClient().getActions($fetch as never);
		const result = await actions.guapocado.plans.list();
		expect(result).toEqual({ data: { plans: [] }, error: null });
	});
});
