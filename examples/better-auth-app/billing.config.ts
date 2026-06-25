import { defineBilling } from "@guapocado/better-auth";

export default defineBilling({
	entitlements: {
		"advanced-analytics": {
			type: "feature",
		},
		"api-calls": {
			type: "meter",
			reset: "monthly",
		},
		seats: {
			type: "limit",
		},
	},
	products: [
		{
			key: "free",
			entitlements: {
				"advanced-analytics": false,
				"api-calls": { included: 1000 },
				seats: { included: 1 },
			},
		},
		{
			key: "pro",
			pricing: {
				mode: "recurring",
				type: "flat",
				amount: 4900,
				currency: "usd",
				frequency: "month",
			},
			entitlements: {
				"advanced-analytics": true,
				"api-calls": {
					included: 100000,
					overage: { allowed: true, unit: 10000, amount: 500, currency: "usd" },
				},
				seats: {
					included: 10,
					expansion: { allowed: true, unit: 1, amount: 1200, currency: "usd" },
				},
			},
		},
	],
	webhooks: {
		devTunnel: true,
		forwarding: [
			{
				key: "better-auth",
				path: "/api/auth/guap",
				events: "*",
				integration: "better-auth",
				description: "Better Auth app webhook receiver",
				autoRegister: true,
			},
		],
	},
});
