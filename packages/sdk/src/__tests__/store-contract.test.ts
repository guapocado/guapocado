import { createMemoryGuapStore } from "../local.js";
import { testGuapStoreContract } from "../testing.js";

// Validates the shipped in-memory store against the shared GuapStore
// contract suite — the same suite a custom SQL/KV-backed implementation
// should run to prove it satisfies get/put/delete/prefix-scan semantics.
testGuapStoreContract("createMemoryGuapStore", () => createMemoryGuapStore());
