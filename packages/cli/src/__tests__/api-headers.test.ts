import { describe, expect, it } from "vitest";
import { GUAPOCADO_CLI_API_VERSION, guapocadoApiHeaders } from "../api-headers.js";

describe("guapocadoApiHeaders", () => {
	it("identifies the CLI package and its pinned API contract", () => {
		expect(guapocadoApiHeaders("sk_test_1")).toMatchObject({
			"x-guapocado-key": "sk_test_1",
			"Guapocado-Version": GUAPOCADO_CLI_API_VERSION,
			"Guapocado-SDK-Version": "0.0.9",
			"Guapocado-SDK-Language": "cli",
		});
	});

	it("merges request-specific headers", () => {
		expect(guapocadoApiHeaders("sk_test_1", { "content-type": "application/json" })).toMatchObject({
			"content-type": "application/json",
		});
	});
});
