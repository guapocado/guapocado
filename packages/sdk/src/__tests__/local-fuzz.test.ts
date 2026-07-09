import { GUAPOCADO_DOMAIN_EVENTS } from "@guapocado/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GuapDomainEventEnvelope } from "../local.js";
import { createGuapLocal, createMemoryGuapStore } from "../local.js";

// `data` shapes that sometimes hit the right key name for a known event type
// (`customer`, `subscription`, ...) but with a malformed/garbage value, plus
// fully arbitrary shapes — exercising both "recognized type, broken payload"
// and "nothing recognizable at all".
const fuzzedData = fc.oneof(
	fc.anything({ maxDepth: 2 }),
	fc.record({ customer: fc.anything({ maxDepth: 2 }) }),
	fc.record({ subscription: fc.anything({ maxDepth: 2 }) }),
	fc.record({ purchase: fc.anything({ maxDepth: 2 }) }),
	fc.record({ invoice: fc.anything({ maxDepth: 2 }) }),
	fc.record({ customerId: fc.anything({ maxDepth: 1 }) }),
	fc.record({ customerId: fc.string(), key: fc.string(), balance: fc.anything({ maxDepth: 1 }) }),
);

const fuzzedEnvelope: fc.Arbitrary<GuapDomainEventEnvelope> = fc.record({
	id: fc.string(),
	type: fc.oneof(fc.constantFrom(...GUAPOCADO_DOMAIN_EVENTS), fc.string()),
	createdAt: fc.oneof(fc.constant(new Date().toISOString()), fc.string(), fc.constant("")),
	data: fuzzedData,
	source: fc.constant({ provider: "guapocado" as const }),
});

describe("project() fuzzing", () => {
	it("never throws for arbitrary envelopes, known type + malformed data included", async () => {
		await fc.assert(
			fc.asyncProperty(fuzzedEnvelope, async (envelope) => {
				const store = createMemoryGuapStore();
				const local = createGuapLocal({
					apiKey: "sk_test",
					store,
					webhook: { autoRegister: false },
				});
				await expect(local.project(envelope)).resolves.toBeUndefined();
			}),
			{ numRuns: 200 },
		);
	});
});
