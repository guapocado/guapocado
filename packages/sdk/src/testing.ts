import { describe, expect, it } from "vitest";
import type { GuapStore, GuapStoreRecord } from "./local.js";

// Test-only subpath: this module imports `vitest`, so only import `@guapocado/sdk/testing` from test files, never from application/production code.

/**
 * Runs a shared vitest contract suite against any {@link GuapStore}
 * implementation — get/put/delete/prefix-scan/overwrite semantics — so a
 * custom SQL- or KV-backed store can be validated the same way the shipped
 * in-memory store is. Call it from your own `*.test.ts` file; it registers
 * `describe`/`it` blocks via vitest, so it must run inside a vitest test file
 * (not standalone), and `vitest` must be present as a dev dependency of the
 * project calling it.
 *
 * @param name - A label for the store implementation, used in the `describe` block title.
 * @param makeStore - Factory returning a fresh, empty {@link GuapStore} for each test — no state shared across tests.
 * @returns Nothing; it registers vitest `describe`/`it` blocks as a side effect.
 * @example
 * ```typescript
 * import { createMemoryGuapStore } from "@guapocado/sdk";
 * import { testGuapStoreContract } from "@guapocado/sdk/testing";
 *
 * // Validate the shipped in-memory store...
 * testGuapStoreContract("memory store", () => createMemoryGuapStore());
 *
 * // ...or your own SQL-backed implementation.
 * testGuapStoreContract("my sqlite store", () => createMySqliteGuapStore(testDb()));
 * ```
 */
export function testGuapStoreContract(
	name: string,
	makeStore: () => GuapStore | Promise<GuapStore>,
): void {
	describe(`GuapStore contract: ${name}`, () => {
		const record = (value: unknown, sourceTs = 1, writtenAt = 1): GuapStoreRecord => ({
			value,
			sourceTs,
			writtenAt,
		});

		it("returns null for a missing record", async () => {
			const store = await makeStore();
			expect(await store.get("customers", "cus_missing")).toBeNull();
		});

		it("round-trips a put record", async () => {
			const store = await makeStore();
			await store.put("customers", "cus_1", record({ id: "cus_1" }));
			expect(await store.get("customers", "cus_1")).toEqual(record({ id: "cus_1" }));
		});

		it("overwrites an existing record on put", async () => {
			const store = await makeStore();
			await store.put("customers", "cus_1", record({ id: "cus_1", name: "A" }));
			await store.put("customers", "cus_1", record({ id: "cus_1", name: "B" }, 2, 2));
			expect(await store.get("customers", "cus_1")).toEqual(
				record({ id: "cus_1", name: "B" }, 2, 2),
			);
		});

		it("deletes a record", async () => {
			const store = await makeStore();
			await store.put("customers", "cus_1", record({ id: "cus_1" }));
			await store.delete("customers", "cus_1");
			expect(await store.get("customers", "cus_1")).toBeNull();
		});

		it("delete is a no-op for a missing record", async () => {
			const store = await makeStore();
			await expect(store.delete("customers", "cus_missing")).resolves.toBeUndefined();
		});

		it("keeps collections independent", async () => {
			const store = await makeStore();
			await store.put("customers", "shared_id", record({ kind: "customer" }));
			await store.put("subscriptions", "shared_id", record({ kind: "subscription" }));
			expect(await store.get("customers", "shared_id")).toEqual(record({ kind: "customer" }));
			expect(await store.get("subscriptions", "shared_id")).toEqual(
				record({ kind: "subscription" }),
			);
		});

		it("lists records by id prefix, excluding non-matching ids", async () => {
			const store = await makeStore();
			await store.put("purchases", "cus_1:pur_1", record({ id: "pur_1" }));
			await store.put("purchases", "cus_1:pur_2", record({ id: "pur_2" }));
			await store.put("purchases", "cus_2:pur_3", record({ id: "pur_3" }));

			const rows = await store.listByPrefix("purchases", "cus_1:");
			expect(rows.map((row) => row.id).sort()).toEqual(["cus_1:pur_1", "cus_1:pur_2"]);
		});

		it("returns an empty list when no id matches the prefix", async () => {
			const store = await makeStore();
			expect(await store.listByPrefix("purchases", "cus_none:")).toEqual([]);
		});
	});
}
