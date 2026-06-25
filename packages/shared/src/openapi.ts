import type { BillingConfig } from "./schema.js";

/**
 * Generates an OpenAPI 3.1 document describing the runtime billing API implied
 * by a billing config, enumerating the entitlement and product keys as path/enum
 * constraints so the spec stays in sync with the config's declared entitlements,
 * products, checkout, usage, and customer endpoints.
 *
 * @param config The billing config whose entitlement and product keys drive the generated paths and schemas.
 * @returns An OpenAPI 3.1 document as a plain object, ready to serialize to JSON or YAML.
 * @example
 * ```ts
 * import { generateOpenApiSpec } from "@guapocado/shared";
 *
 * const spec = generateOpenApiSpec(config);
 * await writeFile("openapi.json", JSON.stringify(spec, null, 2));
 * ```
 */
export function generateOpenApiSpec(config: BillingConfig): Record<string, unknown> {
	const entitlementKeys = Object.keys(config.entitlements);
	const productKeys = config.products.map((p) => p.key);

	return {
		openapi: "3.1.0",
		info: {
			title: "Guapocado Billing API",
			version: "1.0.0",
			description: "Generated billing API from Guapocado config",
		},
		paths: {
			"/v1/entitlements/{key}/has": {
				get: {
					operationId: "hasEntitlement",
					summary: "Check feature access",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
						{ name: "customerId", in: "query", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "Feature access result" } },
				},
			},
			"/v1/entitlements/{key}/limit": {
				get: {
					operationId: "getLimit",
					summary: "Get effective limit",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
						{ name: "customerId", in: "query", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "Effective limit" } },
				},
			},
			"/v1/entitlements/{key}/limit/settings": {
				post: {
					operationId: "configureLimit",
					summary: "Configure purchased limit expansion",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										customerId: { type: "string" },
										purchased: { type: "number", minimum: 0 },
										autoExpansionEnabled: { type: "boolean" },
									},
									required: ["customerId"],
								},
							},
						},
					},
					responses: { "200": { description: "Effective limit" } },
				},
			},
			"/v1/usage/{key}/balance": {
				get: {
					operationId: "getUsageBalance",
					summary: "Get usage balance",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
						{ name: "customerId", in: "query", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "Usage balance" } },
				},
			},
			"/v1/usage/{key}/consume": {
				post: {
					operationId: "consumeUsage",
					summary: "Consume usage balance",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										customerId: { type: "string" },
										amount: { type: "integer" },
									},
									required: ["customerId", "amount"],
								},
							},
						},
					},
					responses: {
						"200": { description: "Updated usage balance" },
						"429": { description: "Insufficient balance" },
					},
				},
			},
			"/v1/usage/{key}/settings": {
				post: {
					operationId: "configureUsage",
					summary: "Configure usage overage",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										customerId: { type: "string" },
										overageEnabled: { type: "boolean" },
									},
									required: ["customerId", "overageEnabled"],
								},
							},
						},
					},
					responses: { "200": { description: "Updated usage balance" } },
				},
			},
			"/v1/usage/{key}/refund": {
				post: {
					operationId: "refundUsage",
					summary: "Refund usage balance",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string", enum: entitlementKeys },
						},
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										customerId: { type: "string" },
										amount: { type: "integer" },
									},
									required: ["customerId", "amount"],
								},
							},
						},
					},
					responses: {
						"200": { description: "Updated usage balance" },
					},
				},
			},
			"/v1/checkout": {
				post: {
					operationId: "createCheckout",
					summary: "Create a checkout session",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										productKey: { type: "string", enum: productKeys },
										planKey: {
											type: "string",
											enum: productKeys,
											deprecated: true,
											description: "Deprecated alias for productKey.",
										},
										customerId: { type: "string" },
										successUrl: { type: "string" },
										cancelUrl: { type: "string" },
									},
									required: ["successUrl", "cancelUrl"],
								},
							},
						},
					},
					responses: { "200": { description: "Checkout URL" } },
				},
			},
			"/v1/customers": {
				get: {
					operationId: "listCustomers",
					summary: "List customers",
					responses: { "200": { description: "Customer list" } },
				},
				post: {
					operationId: "createCustomer",
					summary: "Create a customer",
					responses: { "201": { description: "Customer created" } },
				},
			},
			"/v1/subscriptions": {
				get: {
					operationId: "listSubscriptions",
					summary: "List subscriptions",
					responses: { "200": { description: "Subscription list" } },
				},
			},
			"/v1/purchases": {
				get: {
					operationId: "listPurchases",
					summary: "List one-time purchases",
					parameters: [
						{ name: "customerId", in: "query", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "Purchase list" } },
				},
			},
		},
		components: {
			securitySchemes: {
				apiKey: {
					type: "apiKey",
					in: "header",
					name: "x-guapocado-key",
				},
			},
			schemas: {
				EntitlementKey: { type: "string", enum: entitlementKeys },
				ProductKey: { type: "string", enum: productKeys },
				PlanKey: { type: "string", enum: productKeys, deprecated: true },
			},
		},
		security: [{ apiKey: [] }],
	};
}
