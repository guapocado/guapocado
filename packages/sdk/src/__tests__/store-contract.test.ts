import { describe, expect, it } from "vitest";
import { createMemoryGuapStore } from "../local.js";
import { testGuapStoreContract } from "../testing.js";

// Validates the shipped in-memory store against the shared GuapStore
// contract suite — the same suite a custom SQL/KV-backed implementation
// should run to prove it satisfies get/put/delete/prefix-scan semantics.
testGuapStoreContract("createMemoryGuapStore", () => createMemoryGuapStore());

describe("createMemoryGuapStore — mutation isolation", () => {
	it("never shares record.value by reference with the caller", async () => {
		const store = createMemoryGuapStore();
		const value = { nested: { count: 1 } };
		await store.put("customers", "cus_1", { value, sourceTs: 1, writtenAt: 1 });

		// Mutating the object passed to put() must not affect the stored copy.
		value.nested.count = 999;
		const afterPutMutation = await store.get("customers", "cus_1");
		expect((afterPutMutation?.value as { nested: { count: number } }).nested.count).toBe(1);

		// Mutating the object returned by get() must not affect what's stored.
		(afterPutMutation?.value as { nested: { count: number } }).nested.count = 42;
		const reGet = await store.get("customers", "cus_1");
		expect((reGet?.value as { nested: { count: number } }).nested.count).toBe(1);

		// Mutating a row returned by listByPrefix() must not affect what's stored.
		const rows = await store.listByPrefix("customers", "cus_1");
		(rows[0]?.record.value as { nested: { count: number } }).nested.count = 7;
		const reGetAfterListMutation = await store.get("customers", "cus_1");
		expect((reGetAfterListMutation?.value as { nested: { count: number } }).nested.count).toBe(1);
	});
});
