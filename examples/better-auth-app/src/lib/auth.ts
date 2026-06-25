import { db, schema } from "@/db";
import { type BetterAuthCustomerIdSource, guapocado } from "@guapocado/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

function billingCustomerId(): BetterAuthCustomerIdSource {
	const source = process.env.GUAPOCADO_BILLING_CUSTOMER_ID;
	return source === "team" || source === "organization" ? source : "user";
}

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3010",
	secret: process.env.BETTER_AUTH_SECRET ?? "zJ1wN9Qv8gR2mT6sB4xK7pL0cD5hF3aY",
	database: drizzleAdapter(db, { provider: "sqlite", schema }),
	emailAndPassword: {
		enabled: true,
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 60 * 5,
		},
	},
	plugins: [
		organization({
			teams: {
				enabled: true,
			},
		}),
		guapocado({
			apiKey: process.env.GUAPOCADO_API_KEY ?? "sk_guap_test_demo",
			apiUrl: process.env.GUAPOCADO_API_URL,
			customerId: billingCustomerId(),
			debug: true,
			webhook: {
				path: "/guap",
				events: "*",
				description: "Better Auth app webhook receiver",
				autoRegister: true,
			},
		}),
	],
});
