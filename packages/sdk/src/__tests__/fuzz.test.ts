import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuapocadoValidationError, createGuapocadoClient } from "../index.js";

function okResponse(): Response {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		json: async () => ({ balance: 1 }),
	} as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn(async () => okResponse());
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const guap = () => createGuapocadoClient({ apiKey: "k", customerId: "org_1" });

// An amount that must be rejected: not a positive integer.
const invalidAmount = fc.oneof(
	fc.integer({ max: 0 }),
	fc.double({ noNaN: false }).filter((n) => !Number.isInteger(n)),
	fc.constant(Number.NaN),
	fc.constant(Number.POSITIVE_INFINITY),
);
const validAmount = fc.integer({ min: 1, max: 1_000_000_000 });
const nonEmptyKey = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
const blankKey = fc.stringMatching(/^\s*$/);

describe("SDK input fuzzing", () => {
	it("consume always rejects a non-positive / non-integer amount", () => {
		fc.assert(
			fc.property(fc.string(), invalidAmount, (key, amount) => {
				expect(() => guap().usage.consume(key, amount)).toThrow(GuapocadoValidationError);
			}),
		);
	});

	it("has always rejects a blank key", async () => {
		await fc.assert(
			fc.asyncProperty(blankKey, async (key) => {
				await expect(guap().has(key)).rejects.toBeInstanceOf(GuapocadoValidationError);
			}),
		);
	});

	it("valid consume input always produces a well-formed body", async () => {
		await fc.assert(
			fc.asyncProperty(nonEmptyKey, validAmount, async (key, amount) => {
				await guap().usage.consume(key, amount);
				const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
				const body = JSON.parse(init.body as string);
				expect(body).toMatchObject({ customerId: "org_1", amount });
				expect(Number.isInteger(body.amount) && body.amount > 0).toBe(true);
			}),
			{ numRuns: 100 },
		);
	});

	it("never throws anything other than GuapocadoValidationError for arbitrary read keys", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (key) => {
				try {
					await guap().has(key);
					await guap().limit(key);
					await guap().usage.balance(key);
				} catch (error) {
					if (!(error instanceof GuapocadoValidationError)) throw error;
				}
			}),
			{ numRuns: 100 },
		);
	});

	it("url-encodes arbitrary keys so the request URL stays well-formed", async () => {
		await fc.assert(
			fc.asyncProperty(nonEmptyKey, async (key) => {
				await guap().has(key);
				const url = fetchMock.mock.calls.at(-1)?.[0] as string;
				// Must parse as a valid URL and carry the encoded key.
				expect(() => new URL(url)).not.toThrow();
				expect(url).toContain(encodeURIComponent(key));
			}),
			{ numRuns: 100 },
		);
	});
});
