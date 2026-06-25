export {
	GUAPOCADO_DOMAIN_EVENTS,
	defineBilling,
	defineBillingToJson,
	billingConfigSchema,
} from "./schema.js";
export type {
	BillingConfig,
	BillingFrequency,
	EntitlementDefinition,
	EntitlementPricing,
	EntitlementType,
	GenerateConfig,
	GuapocadoDomainEventType,
	LimitEntitlementValue,
	MeterEntitlementValue,
	OneTimePricingModel,
	PlanDefinition,
	PlanEntitlementValue,
	PricingModel,
	PricingShape,
	RecurringPricingModel,
	TableGenerationConfig,
	WebhookForwardingDefinition,
} from "./schema.js";

export { hashConfig, versionConfig } from "./version.js";
export type { VersionedBillingConfig } from "./version.js";

export { diffConfigs } from "./diff.js";
export type { DiffEntry } from "./diff.js";

export { generateOpenApiSpec } from "./openapi.js";

export { generateTrpcRouterDefinition, generateTrpcRouterCode } from "./trpc.js";
export type { TrpcRouterDefinition } from "./trpc.js";

export {
	BILLING_SCHEMA_VERSION,
	billingJsonSchema,
	fromCanonical,
	toCanonical,
	validateCanonical,
} from "./canonical-schema.js";
export type { CanonicalBillingConfig } from "./canonical-schema.js";
