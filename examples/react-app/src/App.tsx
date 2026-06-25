import {
	GuapocadoProvider,
	type LimitBalance,
	type ReadOnlyGuapocadoClient,
	type UsageBalance,
	type WithGuapocadoProps,
	useEntitlement,
	useGuapocado,
	useLimit,
	useUsageBalance,
	withGuapocado,
} from "@guapocado/react";
import { GuapocadoUIProvider, useGuapocadoUI } from "@guapocado/react/ui";
import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	Separator,
	Skeleton,
} from "@guapocado/react/ui/primitives";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEMO_CLIENT_KEY = "ck_guap_test_demo";

const presets = [
	{ id: "demo_customer", label: "Pro workspace" },
	{ id: "trial_customer", label: "Trial workspace" },
	{ id: "overage_customer", label: "Usage overage" },
] as const;

type Props = {
	apiKey: string;
	initialCustomerId?: string;
};

type CheckState = "idle" | "checking" | "allowed" | "blocked" | "error";

type DemoAccount = {
	advancedAnalytics: boolean;
	apiCalls: UsageBalance;
	customerLabel: string;
	planName: string;
	planPrice: number;
	seats: LimitBalance;
	status: "active" | "trialing" | "past_due";
};

export function App({ apiKey, initialCustomerId = "demo_customer" }: Props) {
	const [customerId, setCustomerId] = useState(initialCustomerId);
	const demoMode = isDemoKey(apiKey);
	const account = getDemoAccount(customerId);
	const mockClient = useMemo(
		() => (demoMode ? createMockGuapClient(customerId) : null),
		[customerId, demoMode],
	);

	return (
		<GuapocadoUIProvider
			currency="USD"
			labels={{ upgrade: "Upgrade plan" }}
			plan={{
				id: account.planName.toLowerCase().replaceAll(" ", "-"),
				interval: "month",
				name: demoMode ? account.planName : "Live API plan",
				price: demoMode ? account.planPrice : null,
			}}
			subscription={{
				currentPeriodEnd: "2026-07-05",
				status: demoMode ? account.status : "live",
			}}
		>
			<main className="min-h-dvh bg-background text-foreground">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
					<header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
						<div className="space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant={demoMode ? "secondary" : "default"}>
									{demoMode ? "Demo data" : "Live API"}
								</Badge>
								<Badge variant="outline">{account.status.replace("_", " ")}</Badge>
							</div>
							<div>
								<p className="text-sm font-medium text-muted-foreground">Guapocado React</p>
								<h1 className="mt-1 text-3xl font-semibold tracking-normal sm:text-4xl">
									Guapocado context and UI primitives
								</h1>
							</div>
						</div>

						<div className="grid gap-3 md:min-w-80">
							<label className="grid gap-2" htmlFor="customer-id">
								<span className="text-xs font-medium uppercase text-muted-foreground">
									Customer ID
								</span>
								<input
									id="customer-id"
									className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
									value={customerId}
									onChange={(event) => setCustomerId(event.currentTarget.value)}
								/>
							</label>
							<div className="flex flex-wrap gap-2">
								{presets.map((preset) => (
									<Button
										key={preset.id}
										type="button"
										size="sm"
										variant={preset.id === customerId ? "secondary" : "outline"}
										onClick={() => setCustomerId(preset.id)}
									>
										{preset.label}
									</Button>
								))}
							</div>
						</div>
					</header>

					<BillingBoundary apiKey={apiKey} client={mockClient} customerId={customerId}>
						<AccountSummary customerId={customerId} demoMode={demoMode} />

						<section className="grid gap-4 lg:grid-cols-3">
							<EntitlementPanel />
							<UsagePanel />
							<LimitPanel />
						</section>

						<section className="grid gap-4 lg:grid-cols-2">
							<DirectClientPanel />
							<WrappedAccessPanel />
						</section>
					</BillingBoundary>
				</div>
			</main>
		</GuapocadoUIProvider>
	);
}

function BillingBoundary({
	apiKey,
	children,
	client,
	customerId,
}: {
	apiKey: string;
	children: ReactNode;
	client: ReadOnlyGuapocadoClient | null;
	customerId: string;
}) {
	if (client) {
		return <GuapocadoProvider client={client}>{children}</GuapocadoProvider>;
	}

	return (
		<GuapocadoProvider apiKey={apiKey} customerId={customerId}>
			{children}
		</GuapocadoProvider>
	);
}

function AccountSummary({ customerId, demoMode }: { customerId: string; demoMode: boolean }) {
	const { formatters, plan, subscription } = useGuapocadoUI();
	const planPrice =
		typeof plan?.price === "number"
			? `${formatters.currency(plan.price)} / ${plan.interval ?? "month"}`
			: "Fetched from API";

	return (
		<Card>
			<CardHeader className="gap-3 md:flex md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<CardTitle>{plan?.name ?? "Workspace plan"}</CardTitle>
					<CardDescription>{customerId}</CardDescription>
				</div>
				<Badge variant={demoMode ? "secondary" : "default"}>
					{demoMode ? "Mock client" : "Integrated client"}
				</Badge>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4 sm:grid-cols-3">
					<SummaryStat label="Plan" value={planPrice} />
					<SummaryStat
						label="Status"
						value={subscription?.status?.replace("_", " ") ?? "unknown"}
					/>
					<SummaryStat
						label="Renews"
						value={
							subscription?.currentPeriodEnd
								? formatters.date(subscription.currentPeriodEnd)
								: "Not available"
						}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function EntitlementPanel() {
	const analytics = useEntitlement("advanced-analytics");
	const status = analytics.loading ? "checking" : statusText(analytics.has);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Entitlement hook</CardTitle>
						<CardDescription>advanced-analytics</CardDescription>
					</div>
					<StatusBadge state={analytics.error ? "error" : status} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<MetricRow label="Access" loading={analytics.loading} value={status} />
				<Separator />
				<p className="text-sm text-muted-foreground">
					Resolved through <code className="font-mono text-foreground">useEntitlement()</code>
				</p>
			</CardContent>
			<CardFooter>
				<Button type="button" variant="outline" onClick={() => void analytics.refetch()}>
					Recheck access
				</Button>
			</CardFooter>
		</Card>
	);
}

function UsagePanel() {
	const apiCalls = useUsageBalance("api-calls");
	const { formatters } = useGuapocadoUI();
	const usage = apiCalls.usage;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Usage balance</CardTitle>
						<CardDescription>api-calls</CardDescription>
					</div>
					<StatusBadge state={apiCalls.error ? "error" : "enabled"} />
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<MetricRow
					label="Remaining"
					loading={apiCalls.loading}
					value={usage ? formatters.number(usage.balance) : "0"}
				/>
				<MetricRow
					label="Consumed"
					loading={apiCalls.loading}
					value={usage ? formatters.number(usage.consumed) : "0"}
				/>
				<MetricRow
					label="Included"
					loading={apiCalls.loading}
					value={usage ? formatters.number(usage.included) : "0"}
				/>
			</CardContent>
			<CardFooter>
				<Button type="button" variant="outline" onClick={() => void apiCalls.refetch()}>
					Refresh usage
				</Button>
			</CardFooter>
		</Card>
	);
}

function LimitPanel() {
	const seats = useLimit("seats");
	const { formatters } = useGuapocadoUI();
	const limitState = seats.limitState;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Limit balance</CardTitle>
						<CardDescription>seats</CardDescription>
					</div>
					<StatusBadge state={seats.error ? "error" : "enabled"} />
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<MetricRow
					label="Limit"
					loading={seats.loading}
					value={limitState ? formatters.number(limitState.limit) : "0"}
				/>
				<MetricRow
					label="Included"
					loading={seats.loading}
					value={limitState ? formatters.number(limitState.included) : "0"}
				/>
				<MetricRow
					label="Purchased"
					loading={seats.loading}
					value={limitState ? formatters.number(limitState.purchased) : "0"}
				/>
			</CardContent>
		</Card>
	);
}

function DirectClientPanel() {
	const guap = useGuapocado();
	const [state, setState] = useState<CheckState>("idle");

	const checkAccess = useCallback(async () => {
		setState("checking");
		try {
			const allowed = await guap.has("advanced-analytics");
			setState(allowed ? "allowed" : "blocked");
		} catch {
			setState("error");
		}
	}, [guap]);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Client primitive</CardTitle>
						<CardDescription>guap.has()</CardDescription>
					</div>
					<StatusBadge state={state} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<code className="block rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
					guap.has("advanced-analytics")
				</code>
				<MetricRow label="Result" loading={state === "checking"} value={state} />
			</CardContent>
			<CardFooter>
				<Button type="button" onClick={() => void checkAccess()}>
					Check access
				</Button>
			</CardFooter>
		</Card>
	);
}

function AccessPanel({ guap }: WithGuapocadoProps) {
	const { labels } = useGuapocadoUI();
	const [hasReports, setHasReports] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		setHasReports(null);

		guap
			.has("advanced-analytics")
			.then((allowed) => {
				if (!cancelled) setHasReports(allowed);
			})
			.catch(() => {
				if (!cancelled) {
					setFailed(true);
					setHasReports(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [guap]);

	const state = failed ? "error" : hasReports === null ? "checking" : statusText(hasReports);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Higher-order component</CardTitle>
						<CardDescription>withGuapocado()</CardDescription>
					</div>
					<StatusBadge state={state} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<MetricRow label="Reports" loading={hasReports === null && !failed} value={state} />
				<Separator />
				<Badge variant={hasReports ? "secondary" : "outline"}>
					{hasReports ? "Enabled" : labels.upgrade}
				</Badge>
			</CardContent>
		</Card>
	);
}

const WrappedAccessPanel = withGuapocado(AccessPanel);

function SummaryStat({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="rounded-md border border-border bg-background p-3">
			<p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
			<p className="mt-1 text-sm font-semibold">{value}</p>
		</div>
	);
}

function MetricRow({
	label,
	loading,
	value,
}: {
	label: string;
	loading?: boolean;
	value: ReactNode;
}) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-4">
			<span className="text-sm text-muted-foreground">{label}</span>
			{loading ? <Skeleton className="h-5 w-24" /> : <strong className="text-sm">{value}</strong>}
		</div>
	);
}

function StatusBadge({ state }: { state: string }) {
	const variant =
		state === "allowed" || state === "enabled"
			? "secondary"
			: state === "blocked" || state === "error"
				? "destructive"
				: "outline";

	return <Badge variant={variant}>{state}</Badge>;
}

function isDemoKey(apiKey: string) {
	return !apiKey || apiKey === DEMO_CLIENT_KEY || apiKey.includes("replace_me");
}

function statusText(value: boolean | null) {
	if (value === null) return "checking";
	return value ? "enabled" : "blocked";
}

function getDemoAccount(customerId: string): DemoAccount {
	const normalized = customerId.toLowerCase();

	if (normalized.includes("trial")) {
		return {
			advancedAnalytics: false,
			apiCalls: {
				balance: 860,
				consumed: 1140,
				included: 2000,
				overage: 0,
				overageAllowed: false,
				overageEnabled: false,
				resets: "2026-07-05",
			},
			customerLabel: "Trial workspace",
			planName: "Starter trial",
			planPrice: 0,
			seats: {
				autoExpansionEnabled: false,
				expansionAllowed: true,
				included: 3,
				limit: 3,
				purchased: 0,
			},
			status: "trialing",
		};
	}

	if (normalized.includes("overage")) {
		return {
			advancedAnalytics: true,
			apiCalls: {
				balance: -320,
				consumed: 25320,
				included: 25000,
				overage: 320,
				overageAllowed: true,
				overageEnabled: true,
				resets: "2026-07-05",
			},
			customerLabel: "Usage overage",
			planName: "Scale",
			planPrice: 149,
			seats: {
				autoExpansionEnabled: true,
				expansionAllowed: true,
				included: 10,
				limit: 16,
				purchased: 6,
			},
			status: "past_due",
		};
	}

	return {
		advancedAnalytics: true,
		apiCalls: {
			balance: 6760,
			consumed: 18240,
			included: 25000,
			overage: 0,
			overageAllowed: true,
			overageEnabled: false,
			resets: "2026-07-05",
		},
		customerLabel: "Pro workspace",
		planName: "Pro",
		planPrice: 49,
		seats: {
			autoExpansionEnabled: false,
			expansionAllowed: true,
			included: 5,
			limit: 12,
			purchased: 7,
		},
		status: "active",
	};
}

function createMockGuapClient(customerId: string): ReadOnlyGuapocadoClient {
	return {
		async has(key, options) {
			const account = getDemoAccount(options?.customerId ?? customerId);
			await delay(180);
			return key === "advanced-analytics" ? account.advancedAnalytics : false;
		},
		async limit(key, options) {
			const account = getDemoAccount(options?.customerId ?? customerId);
			await delay(220);
			return key === "seats" ? account.seats : emptyLimit();
		},
		usage: {
			async balance(key, options) {
				const account = getDemoAccount(options?.customerId ?? customerId);
				await delay(240);
				return key === "api-calls" ? account.apiCalls : emptyUsage();
			},
		},
	};
}

function emptyLimit(): LimitBalance {
	return {
		autoExpansionEnabled: false,
		expansionAllowed: false,
		included: 0,
		limit: 0,
		purchased: 0,
	};
}

function emptyUsage(): UsageBalance {
	return {
		balance: 0,
		consumed: 0,
		included: 0,
		overage: 0,
		overageAllowed: false,
		overageEnabled: false,
		resets: null,
	};
}

function delay(ms: number) {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
