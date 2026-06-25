import { createGuapocadoClient } from "./client.js";

type ProcedureHandler = (fn: (opts: { input: never }) => unknown) => unknown;

type TrpcLike = {
	router: (routes: Record<string, unknown>) => unknown;
	procedure: {
		input: (schema: unknown) => {
			query: ProcedureHandler;
			mutation: ProcedureHandler;
		};
	};
};

/**
 * Builds a small tRPC sub-router whose procedures proxy to a Guapocado server
 * client. It exposes `entitlements` (`has`, `limit`, `configureLimit`) and
 * `usage` (`balance`, `consume`, `refund`, `configure`) procedures, each taking
 * a `customerId` in its input. The router is created with your own tRPC and Zod
 * instances so it stays compatible with the versions in your app.
 *
 * @param t - Your initialized tRPC builder, providing `router` and `procedure`.
 * @param opts - Options forwarded to the underlying client; must include the
 *   secret `apiKey` used for server-side API calls.
 * @param z - Your Zod instance, used to declare each procedure's input schema
 *   (`object`, `string`, `number`, `boolean`).
 * @returns A tRPC router with nested `entitlements` and `usage` procedures.
 * @example
 * ```typescript
 * import { initTRPC } from "@trpc/server";
 * import { z } from "zod";
 * import { createGuapocadoTrpcRouter } from "@guapocado/sdk/trpc";
 *
 * const t = initTRPC.create();
 * export const billingRouter = createGuapocadoTrpcRouter(
 * 	t,
 * 	{ apiKey: process.env.GUAPOCADO_API_KEY! },
 * 	z,
 * );
 * // client: trpc.billing.entitlements.has.query({ key: "advanced-analytics", customerId: "org_123" })
 * ```
 */
export function createGuapocadoTrpcRouter(
	t: TrpcLike,
	opts: { apiKey: string },
	z: {
		object: (shape: Record<string, unknown>) => unknown;
		string: () => { optional: () => unknown };
		number: () => unknown;
		boolean: () => unknown;
	},
) {
	const guap = createGuapocadoClient(opts);

	return t.router({
		entitlements: t.router({
			has: t.procedure
				.input(z.object({ key: z.string(), customerId: z.string() }))
				.query(({ input }: { input: { key: string; customerId: string } }) =>
					guap.has(input.key, { customerId: input.customerId }),
				),
			limit: t.procedure
				.input(z.object({ key: z.string(), customerId: z.string() }))
				.query(({ input }: { input: { key: string; customerId: string } }) =>
					guap.limit(input.key, { customerId: input.customerId }),
				),
			configureLimit: t.procedure
				.input(
					z.object({
						key: z.string(),
						customerId: z.string(),
						purchased: z.number(),
						autoExpansionEnabled: z.boolean(),
					}),
				)
				.mutation(
					({
						input,
					}: {
						input: {
							key: string;
							customerId: string;
							purchased?: number;
							autoExpansionEnabled?: boolean;
						};
					}) =>
						guap.limits.configure(
							input.key,
							{
								purchased: input.purchased,
								autoExpansionEnabled: input.autoExpansionEnabled,
							},
							{ customerId: input.customerId },
						),
				),
		}),
		usage: t.router({
			balance: t.procedure
				.input(z.object({ key: z.string(), customerId: z.string() }))
				.query(({ input }: { input: { key: string; customerId: string } }) =>
					guap.usage.balance(input.key, { customerId: input.customerId }),
				),
			consume: t.procedure
				.input(
					z.object({
						key: z.string(),
						customerId: z.string(),
						amount: z.number(),
						idempotencyKey: z.string().optional(),
					}),
				)
				.mutation(
					({
						input,
					}: {
						input: { key: string; customerId: string; amount: number; idempotencyKey?: string };
					}) =>
						guap.usage.consume(input.key, input.amount, {
							customerId: input.customerId,
							idempotencyKey: input.idempotencyKey,
						}),
				),
			refund: t.procedure
				.input(z.object({ key: z.string(), customerId: z.string(), amount: z.number() }))
				.mutation(({ input }: { input: { key: string; customerId: string; amount: number } }) =>
					guap.usage.refund(input.key, input.amount, { customerId: input.customerId }),
				),
			configure: t.procedure
				.input(
					z.object({
						key: z.string(),
						customerId: z.string(),
						overageEnabled: z.boolean(),
					}),
				)
				.mutation(
					({ input }: { input: { key: string; customerId: string; overageEnabled: boolean } }) =>
						guap.usage.configure(
							input.key,
							{ overageEnabled: input.overageEnabled },
							{ customerId: input.customerId },
						),
				),
		}),
	});
}

/**
 * Backward-compatible alias of {@link createGuapocadoTrpcRouter} that builds the
 * same entitlements-and-usage tRPC router. Prefer the
 * `createGuapocadoTrpcRouter` name in new code.
 *
 * @deprecated Use createGuapocadoTrpcRouter.
 */
export const createBillingTrpcRouter = createGuapocadoTrpcRouter;
