"use client";

import { guapocadoClient } from "@guapocado/better-auth/client";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState } from "react";

const authClient = createAuthClient({
	plugins: [guapocadoClient()],
});

type BillingStatus = {
	customerId: string;
	advancedAnalytics: boolean;
	remainingApiCalls: number;
	currentPlanKey: string | null;
	subscriptionStatus: string | null;
	user?: { email?: string | null; name?: string | null };
};

type PlanPricing = {
	mode?: string;
	type?: string;
	amount?: number;
	currency?: string;
	frequency?: string;
	interval?: string;
};

type PlanConfig = {
	pricing?: PlanPricing;
	entitlements?: Record<string, unknown>;
};

type DemoPlan = {
	id: string;
	key: string;
	name?: string | null;
	config?: PlanConfig;
};

function formatPrice(pricing?: PlanPricing) {
	if (!pricing?.amount || !pricing.currency) return "Free";
	const amount = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: pricing.currency.toUpperCase(),
	}).format(pricing.amount / 100);
	const cadence = pricing.frequency ?? pricing.interval;
	return pricing.mode === "recurring" && cadence ? `${amount}/${cadence}` : amount;
}

function planAmount(plan: DemoPlan): number {
	return plan.config?.pricing?.amount ?? 0;
}

function entitlementSummary(config?: PlanConfig) {
	const entitlements = config?.entitlements ?? {};
	return Object.entries(entitlements).map(([key, value]) => {
		if (typeof value === "boolean") return `${key}: ${value ? "included" : "not included"}`;
		if (value && typeof value === "object" && "included" in value) {
			return `${key}: ${(value as { included?: unknown }).included} included`;
		}
		return key;
	});
}

export function BillingDemo() {
	const [authFormReady, setAuthFormReady] = useState(false);
	const [email, setEmail] = useState("demo@example.com");
	const [password, setPassword] = useState("password123");
	const [status, setStatus] = useState<BillingStatus | null>(null);
	const [plans, setPlans] = useState<DemoPlan[]>([]);
	const [message, setMessage] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setMessage(null);
		try {
			const { data: context, error } = await authClient.guapocado.context({
				features: ["advanced-analytics"],
				usage: ["api-calls"],
				includePlans: true,
				includeSubscription: true,
				debug: true,
			});
			if (error || !context) {
				setStatus(null);
				setMessage(error?.message ?? "Could not load billing status");
				return;
			}
			setPlans(context.plans as DemoPlan[]);
			setStatus({
				customerId: context.customerId,
				advancedAnalytics: context.features["advanced-analytics"] ?? false,
				remainingApiCalls: context.usage["api-calls"]?.balance ?? 0,
				currentPlanKey: context.subscription?.planKey ?? null,
				subscriptionStatus: context.subscription?.status ?? null,
			});
		} catch (error) {
			setStatus(null);
			setMessage(error instanceof Error ? error.message : "Could not load billing status");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		authClient.getSession().then(({ data }) => {
			if (data?.user) void refresh();
		});
	}, [refresh]);

	useEffect(() => {
		setAuthFormReady(true);
	}, []);

	async function signUpOrIn(mode: "sign-up" | "sign-in") {
		setLoading(true);
		setMessage(null);
		const result =
			mode === "sign-up"
				? await authClient.signUp.email({ email, password, name: "Demo User" })
				: await authClient.signIn.email({ email, password });
		if (result.error) {
			setMessage(result.error.message ?? "Auth failed");
		} else {
			await refresh();
		}
		setLoading(false);
	}

	async function useApiCall() {
		setLoading(true);
		setMessage(null);
		try {
			const { data, error } = await authClient.guapocado.usage.consume("api-calls", 1);
			if (error || !data) {
				setMessage(error?.message ?? "Usage failed");
				return;
			}
			setMessage(`Usage recorded. Remaining API calls: ${data.balance}`);
			setStatus((current) => (current ? { ...current, remainingApiCalls: data.balance } : current));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Usage failed");
		} finally {
			setLoading(false);
		}
	}

	async function checkout(productKey: string) {
		setLoading(true);
		setMessage(null);
		try {
			const { data, error } = await authClient.guapocado.checkout.create({
				productKey,
				successUrl: `${window.location.origin}/`,
				cancelUrl: `${window.location.origin}/`,
			});
			if (error || !data) {
				setMessage(error?.message ?? "Checkout failed");
				setLoading(false);
				return;
			}
			window.location.href = data.url;
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Checkout failed");
			setLoading(false);
		}
	}

	async function changePlan(planKey: string) {
		setLoading(true);
		setMessage(null);
		try {
			const { data, error } = await authClient.guapocado.subscription.change(planKey);
			if (error || !data) {
				setMessage(error?.message ?? "Plan change failed");
				return;
			}
			setMessage(
				data.subscription.changed
					? `Subscription changed to ${data.subscription.planKey}.`
					: `Already on ${data.subscription.planKey}.`,
			);
			await refresh();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Plan change failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="shell">
			<section className="panel">
				<h1>Better Auth billing demo</h1>
				<p>
					This app signs in with Better Auth, stores auth data in SQLite through Drizzle, then
					checks and consumes Guapocado entitlements for the signed-in user.
				</p>
				{authFormReady ? (
					<div className="fields">
						<input
							name="email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(event) => setEmail(event.currentTarget.value)}
						/>
						<input
							name="password"
							type="password"
							value={password}
							autoComplete="current-password"
							onChange={(event) => setPassword(event.currentTarget.value)}
						/>
					</div>
				) : (
					<div className="fields" aria-hidden="true">
						<div className="input-placeholder" />
						<div className="input-placeholder" />
					</div>
				)}
				<div className="actions">
					<button type="button" disabled={loading} onClick={() => signUpOrIn("sign-up")}>
						Sign up
					</button>
					<button type="button" disabled={loading} onClick={() => signUpOrIn("sign-in")}>
						Sign in
					</button>
					<button
						type="button"
						disabled={loading}
						onClick={async () => {
							await authClient.signOut();
							setStatus(null);
						}}
					>
						Sign out
					</button>
				</div>
			</section>

			<section className="panel">
				<h2>Entitlements</h2>
				{status ? (
					<dl>
						<div>
							<dt>Customer</dt>
							<dd>{status.customerId}</dd>
						</div>
						<div>
							<dt>Advanced analytics</dt>
							<dd>{status.advancedAnalytics ? "enabled" : "disabled"}</dd>
						</div>
						<div>
							<dt>API calls remaining</dt>
							<dd>{status.remainingApiCalls}</dd>
						</div>
						<div>
							<dt>Subscription status</dt>
							<dd>{status.subscriptionStatus ?? "none"}</dd>
						</div>
					</dl>
				) : (
					<p>Sign in to load billing state.</p>
				)}
				<div className="actions">
					<button type="button" disabled={loading} onClick={refresh}>
						Refresh
					</button>
					<button type="button" disabled={loading || !status} onClick={useApiCall}>
						Use API call
					</button>
				</div>
				{message && <p className="message">{message}</p>}
			</section>

			<section className="panel">
				<h2>Plans</h2>
				{plans.length > 0 ? (
					<div className="plans">
						{plans.map((plan) => {
							const isCurrent = status?.currentPlanKey === plan.key;
							const currentPlan = plans.find(
								(candidate) => candidate.key === status?.currentPlanKey,
							);
							const hasActiveSubscription = [
								"active",
								"trialing",
								"past_due",
								"incomplete",
							].includes(status?.subscriptionStatus ?? "");
							const isDowngrade =
								hasActiveSubscription && currentPlan
									? planAmount(plan) < planAmount(currentPlan)
									: false;
							const config = plan.config;
							const entitlements = entitlementSummary(config);
							return (
								<article key={plan.key} className={isCurrent ? "plan current" : "plan"}>
									<div className="plan-header">
										<div>
											<h3>{plan.name ?? plan.key}</h3>
											<p className="plan-key">{plan.key}</p>
										</div>
										{isCurrent && <span className="badge">Current plan</span>}
									</div>
									<div className="price">{formatPrice(config?.pricing)}</div>
									<ul>
										{entitlements.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
									<button
										type="button"
										disabled={
											loading ||
											!status ||
											isCurrent ||
											(!hasActiveSubscription && !config?.pricing)
										}
										onClick={() =>
											hasActiveSubscription ? changePlan(plan.key) : checkout(plan.key)
										}
									>
										{isCurrent
											? "Current plan"
											: hasActiveSubscription
												? isDowngrade
													? "Downgrade"
													: "Change plan"
												: config?.pricing
													? "Choose plan"
													: "Included"}
									</button>
								</article>
							);
						})}
					</div>
				) : (
					<p>Sign in to load available plans.</p>
				)}
			</section>
		</div>
	);
}
