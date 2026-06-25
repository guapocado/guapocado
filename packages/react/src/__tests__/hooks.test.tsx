// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	GuapocadoProvider,
	type ReadOnlyGuapocadoClient,
	useEntitlement,
	useGuapocado,
	useLimit,
	useUsageBalance,
} from "../index.js";

function wrapperWith(client: Partial<ReadOnlyGuapocadoClient>) {
	return ({ children }: { children: ReactNode }) =>
		createElement(GuapocadoProvider, { client: client as ReadOnlyGuapocadoClient }, children);
}

describe("provider wiring", () => {
	it("throws when a hook is used outside a provider", () => {
		expect(() => renderHook(() => useGuapocado())).toThrow(/GuapocadoProvider/);
	});

	it("requires a client or apiKey", () => {
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(GuapocadoProvider, {}, children);
		expect(() => renderHook(() => useGuapocado(), { wrapper })).toThrow(/client or an apiKey/);
	});

	it("exposes the injected client", () => {
		const client = { has: vi.fn() } as unknown as ReadOnlyGuapocadoClient;
		const { result } = renderHook(() => useGuapocado(), { wrapper: wrapperWith(client) });
		expect(result.current).toBe(client);
	});
});

describe("useEntitlement", () => {
	it("resolves to the has() result", async () => {
		const has = vi.fn(async () => true);
		const { result } = renderHook(() => useEntitlement("analytics"), {
			wrapper: wrapperWith({ has }),
		});
		expect(result.current.loading).toBe(true);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.has).toBe(true);
		expect(has).toHaveBeenCalledWith("analytics", { customerId: undefined });
	});

	it("captures errors and falls back to has=false", async () => {
		const has = vi.fn(async () => {
			throw new Error("boom");
		});
		const { result } = renderHook(() => useEntitlement("x", { customerId: "org_2" }), {
			wrapper: wrapperWith({ has }),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.has).toBe(false);
		expect(result.current.error).toBeInstanceOf(Error);
		expect(has).toHaveBeenCalledWith("x", { customerId: "org_2" });
	});
});

describe("useUsageBalance", () => {
	it("returns the balance and recovers from errors with zeros", async () => {
		const balance = vi.fn(async () => ({
			balance: 42,
			included: 100,
			consumed: 58,
			overage: 0,
			overageAllowed: false,
			overageEnabled: false,
			resets: null,
		}));
		const ok = renderHook(() => useUsageBalance("api"), {
			wrapper: wrapperWith({ usage: { balance } as never }),
		});
		await waitFor(() => expect(ok.result.current.loading).toBe(false));
		expect(ok.result.current.balance).toBe(42);

		const failing = vi.fn(async () => {
			throw new Error("nope");
		});
		const bad = renderHook(() => useUsageBalance("api"), {
			wrapper: wrapperWith({ usage: { balance: failing } as never }),
		});
		await waitFor(() => expect(bad.result.current.loading).toBe(false));
		expect(bad.result.current.balance).toBe(0);
		expect(bad.result.current.error).toBeInstanceOf(Error);
	});
});

describe("useLimit", () => {
	it("returns the effective limit", async () => {
		const limit = vi.fn(async () => ({
			limit: 10,
			included: 5,
			purchased: 5,
			expansionAllowed: true,
			autoExpansionEnabled: false,
		}));
		const { result } = renderHook(() => useLimit("seats"), { wrapper: wrapperWith({ limit }) });
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.limit).toBe(10);
		expect(result.current.limitState?.expansionAllowed).toBe(true);
	});
});
