export type DrizzleDialect = "mysql" | "pg" | "sqlite";

export function normalizeDrizzleDialect(value: string | undefined): DrizzleDialect | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (["sqlite", "sqlite3", "libsql", "turso", "d1"].includes(normalized)) return "sqlite";
	if (["pg", "pgsql", "postgres", "postgresql"].includes(normalized)) return "pg";
	if (["mysql", "mysql2", "mariadb", "planetscale"].includes(normalized)) return "mysql";
	return null;
}

export function generateDrizzleServerTables(dialect: DrizzleDialect): string {
	if (dialect === "sqlite") return generateSqliteTables();
	if (dialect === "pg") return generatePostgresTables();
	return generateMysqlTables();
}

function generateDrizzleAdapter(dialect: DrizzleDialect): string {
	const databaseTimestampFunction =
		dialect === "sqlite"
			? `function toDatabaseTimestamp(value: unknown): string | null {
\tconst iso = toIsoString(value);
\treturn iso;
}

function adapterNow(): string {
\treturn new Date().toISOString();
}`
			: `function toDatabaseTimestamp(value: unknown): Date | null {
\tif (value === null || value === undefined || value === "") return null;
\tif (value instanceof Date) return value;
\tconst date = new Date(String(value));
\treturn Number.isNaN(date.getTime()) ? null : date;
}

function adapterNow(): Date {
\treturn new Date();
}`;

	const conflict = {
		customer:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: ".onConflictDoUpdate({ target: guapocadoCustomers.id, set: update });",
		plan:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: ".onConflictDoUpdate({ target: guapocadoPlans.key, set: update });",
		subscription:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: ".onConflictDoUpdate({ target: guapocadoSubscriptions.id, set: update });",
		purchase:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: ".onConflictDoUpdate({ target: guapocadoPurchases.id, set: update });",
		entitlement:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: `.onConflictDoUpdate({
\t\t\ttarget: [guapocadoCustomerEntitlements.customerId, guapocadoCustomerEntitlements.key],
\t\t\tset: update,
\t\t});`,
		setting:
			dialect === "mysql"
				? ".onDuplicateKeyUpdate({ set: update });"
				: `.onConflictDoUpdate({
\t\t\ttarget: [
\t\t\t\tguapocadoCustomerEntitlementSettings.customerId,
\t\t\t\tguapocadoCustomerEntitlementSettings.key,
\t\t\t],
\t\t\tset: update,
\t\t});`,
	};

	return `
export type GuapDrizzleDatabase = {
\tselect(fields?: unknown): any;
\tinsert(table: unknown): any;
};

type GuapEntitlementType = "feature" | "meter" | "limit";

type GuapEntitlementConfig = {
\toverage?: { allowed?: boolean };
\texpansion?: { allowed?: boolean };
\tresets?: string | null;
};

type GuapEntitlementRow = {
\tkey: string;
\ttype: string;
\tvalueBool: number | boolean | null;
\tvalueNum: number | null;
\tvalueRemaining: number | null;
\tvalueLimit: number | null;
\tconfig: string;
\tresetPeriod: string | null;
\tlastResetAt: string | Date | null;
\toverageEnabled: number | boolean | null;
\tpurchased: number | null;
\tautoExpansionEnabled: number | boolean | null;
};

function guapAdapterId(prefix: string): string {
\treturn prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function stringifyJson(value: unknown): string {
\ttry {
\t\treturn JSON.stringify(value ?? {});
\t} catch {
\t\treturn "{}";
\t}
}

function parseConfig(value: unknown): GuapEntitlementConfig {
\tif (typeof value !== "string" || value.length === 0) return {};
\ttry {
\t\tconst parsed = JSON.parse(value) as GuapEntitlementConfig;
\t\treturn parsed && typeof parsed === "object" ? parsed : {};
\t} catch {
\t\treturn {};
\t}
}

function toIsoString(value: unknown): string | null {
\tif (value === null || value === undefined || value === "") return null;
\tif (value instanceof Date) return value.toISOString();
\treturn String(value);
}

${databaseTimestampFunction}

function toFlag(value: boolean): number {
\treturn value ? 1 : 0;
}

function fromFlag(value: unknown): boolean {
\treturn value === true || value === 1;
}

function nextReset(lastResetAt: unknown, resetPeriod: unknown): string | null {
\tconst lastReset = toIsoString(lastResetAt);
\tif (!lastReset || typeof resetPeriod !== "string") return null;
\tconst date = new Date(lastReset);
\tif (Number.isNaN(date.getTime())) return null;
\tif (resetPeriod === "daily") date.setUTCDate(date.getUTCDate() + 1);
\telse if (resetPeriod === "weekly") date.setUTCDate(date.getUTCDate() + 7);
\telse if (resetPeriod === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
\telse return null;
\treturn date.toISOString();
}

async function findCustomer(db: GuapDrizzleDatabase, customerId: string): Promise<Customer | null> {
\tconst rows = await db
\t\t.select({
\t\t\tid: guapocadoCustomers.id,
\t\t\tname: guapocadoCustomers.name,
\t\t\temail: guapocadoCustomers.email,
\t\t})
\t\t.from(guapocadoCustomers)
\t\t.where(eq(guapocadoCustomers.id, customerId))
\t\t.limit(1);
\treturn (rows[0] as Customer | undefined) ?? null;
}

async function findEntitlement(
\tdb: GuapDrizzleDatabase,
\tcustomerId: string,
\tkey: string,
\ttype: GuapEntitlementType,
): Promise<GuapEntitlementRow | undefined> {
\tconst rows = await db
\t\t.select({
\t\t\tkey: guapocadoCustomerEntitlements.key,
\t\t\ttype: guapocadoCustomerEntitlements.type,
\t\t\tvalueBool: guapocadoCustomerEntitlements.valueBool,
\t\t\tvalueNum: guapocadoCustomerEntitlements.valueNum,
\t\t\tvalueRemaining: guapocadoCustomerEntitlements.valueRemaining,
\t\t\tvalueLimit: guapocadoCustomerEntitlements.valueLimit,
\t\t\tconfig: guapocadoCustomerEntitlements.config,
\t\t\tresetPeriod: guapocadoCustomerEntitlements.resetPeriod,
\t\t\tlastResetAt: guapocadoCustomerEntitlements.lastResetAt,
\t\t\toverageEnabled: guapocadoCustomerEntitlementSettings.overageEnabled,
\t\t\tpurchased: guapocadoCustomerEntitlementSettings.purchased,
\t\t\tautoExpansionEnabled: guapocadoCustomerEntitlementSettings.autoExpansionEnabled,
\t\t})
\t\t.from(guapocadoCustomerEntitlements)
\t\t.leftJoin(
\t\t\tguapocadoCustomerEntitlementSettings,
\t\t\tand(
\t\t\t\teq(
\t\t\t\t\tguapocadoCustomerEntitlementSettings.customerId,
\t\t\t\t\tguapocadoCustomerEntitlements.customerId,
\t\t\t\t),
\t\t\t\teq(guapocadoCustomerEntitlementSettings.key, guapocadoCustomerEntitlements.key),
\t\t\t),
\t\t)
\t\t.where(
\t\t\tand(
\t\t\t\teq(guapocadoCustomerEntitlements.customerId, customerId),
\t\t\t\teq(guapocadoCustomerEntitlements.key, key),
\t\t\t\teq(guapocadoCustomerEntitlements.type, type),
\t\t\t),
\t\t)
\t\t.limit(1);
\treturn rows[0] as GuapEntitlementRow | undefined;
}

function toLimitBalance(row: GuapEntitlementRow): LimitBalance {
\tconst included = row.valueNum ?? 0;
\tconst config = parseConfig(row.config);
\tconst purchased = row.purchased ?? 0;
\tconst expansionAllowed = config.expansion?.allowed === true || purchased > 0;
\treturn {
\t\tlimit: included + purchased,
\t\tincluded,
\t\tpurchased,
\t\texpansionAllowed,
\t\tautoExpansionEnabled: config.expansion?.allowed === true && fromFlag(row.autoExpansionEnabled),
\t};
}

function toUsageBalance(row: GuapEntitlementRow): UsageBalance {
\tconst included = row.valueLimit ?? 0;
\tconst rawBalance = row.valueRemaining ?? 0;
\tconst config = parseConfig(row.config);
\tconst overageAllowed = config.overage?.allowed === true;
\treturn {
\t\tbalance: Math.max(0, rawBalance),
\t\tincluded,
\t\tconsumed: Math.max(0, included - rawBalance),
\t\toverage: Math.max(0, -rawBalance),
\t\toverageAllowed,
\t\toverageEnabled: overageAllowed && fromFlag(row.overageEnabled),
\t\tresets: nextReset(row.lastResetAt, row.resetPeriod) ?? config.resets ?? null,
\t};
}

function toPlan(row: any): Product {
\treturn {
\t\tid: row.id,
\t\tkey: row.key,
\t\tname: row.name ?? null,
\t\tconfig: parseConfig(row.config),
\t\tstripeProductId: row.stripeProductId ?? null,
\t\tstripePriceId: row.stripePriceId ?? null,
\t\tcreatedAt: toIsoString(row.createdAt),
\t\tupdatedAt: toIsoString(row.updatedAt),
\t};
}

function toPurchase(row: any): Purchase {
\treturn {
\t\tid: row.id,
\t\tcustomerId: row.customerId,
\t\tproductKey: row.productKey,
\t\tstatus: row.status,
\t\tamount: row.amount ?? 0,
\t\tcurrency: row.currency ?? "usd",
\t\tquantity: row.quantity ?? 1,
\t\tstripeCheckoutSessionId: row.stripeCheckoutSessionId ?? null,
\t\tstripePaymentIntentId: row.stripePaymentIntentId ?? null,
\t\tcompletedAt: toIsoString(row.completedAt),
\t\tcreatedAt: toIsoString(row.createdAt),
\t\tupdatedAt: toIsoString(row.updatedAt),
\t};
}

function toSubscription(row: any): Subscription {
\treturn {
\t\tid: row.id,
\t\tcustomerId: row.customerId,
\t\tplanKey: row.planKey,
\t\tstatus: row.status,
\t\tstripeSubscriptionId: row.stripeSubscriptionId ?? null,
\t\tcurrentPeriodEnd: toIsoString(row.currentPeriodEnd),
\t\tcreatedAt: toIsoString(row.createdAt),
\t\tupdatedAt: toIsoString(row.updatedAt),
\t};
}

async function readPlans(db: GuapDrizzleDatabase): Promise<Product[]> {
\tconst rows = await db.select().from(guapocadoPlans);
\treturn (rows as any[]).map(toPlan);
}

async function readPurchases(db: GuapDrizzleDatabase, customerId: string): Promise<Purchase[]> {
\tconst rows = await db
\t\t.select()
\t\t.from(guapocadoPurchases)
\t\t.where(eq(guapocadoPurchases.customerId, customerId))
\t\t.orderBy(desc(guapocadoPurchases.createdAt));
\treturn (rows as any[]).map(toPurchase);
}

async function readCurrentSubscription(
\tdb: GuapDrizzleDatabase,
\tcustomerId: string,
): Promise<Subscription | null | undefined> {
\tconst rows = await db
\t\t.select()
\t\t.from(guapocadoSubscriptions)
\t\t.where(eq(guapocadoSubscriptions.customerId, customerId))
\t\t.orderBy(desc(guapocadoSubscriptions.createdAt))
\t\t.limit(10);
\tconst subscription =
\t\t(rows as any[]).find((row) =>
\t\t\t["active", "trialing", "past_due", "incomplete"].includes(row.status),
\t\t) ??
\t\t(rows as any[])[0] ??
\t\tundefined;
\treturn subscription ? toSubscription(subscription) : undefined;
}

async function upsertCustomer(
\tdb: GuapDrizzleDatabase,
\tcustomer: { id: string; name?: string | null; email?: string | null; stripeCustomerId?: string | null; metadata?: unknown },
): Promise<void> {
\tconst update = {
\t\tstripeCustomerId: customer.stripeCustomerId ?? null,
\t\tname: customer.name ?? null,
\t\temail: customer.email ?? null,
\t\tmetadata: stringifyJson(customer.metadata ?? {}),
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoCustomers)
\t\t.values({
\t\t\tid: customer.id,
\t\t\t...update,
\t\t})
\t\t${conflict.customer}
}

async function upsertPlan(db: GuapDrizzleDatabase, plan: BillingPlan): Promise<void> {
\tconst update = {
\t\tname: plan.name ?? null,
\t\tconfig: stringifyJson(plan.config ?? {}),
\t\tstripeProductId: plan.stripeProductId ?? null,
\t\tstripePriceId: plan.stripePriceId ?? null,
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoPlans)
\t\t.values({
\t\t\tid: plan.id,
\t\t\tkey: plan.key,
\t\t\t...update,
\t\t})
\t\t${conflict.plan}
}

async function upsertSubscription(
\tdb: GuapDrizzleDatabase,
\tsubscription: Subscription | null,
): Promise<void> {
\tif (!subscription) return;
\tawait upsertCustomer(db, { id: subscription.customerId });
\tconst update = {
\t\tstripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
\t\tplanKey: subscription.planKey,
\t\tstatus: subscription.status,
\t\tcurrentPeriodStart: toDatabaseTimestamp((subscription as { currentPeriodStart?: string | null }).currentPeriodStart),
\t\tcurrentPeriodEnd: toDatabaseTimestamp(subscription.currentPeriodEnd),
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoSubscriptions)
\t\t.values({
\t\t\tid: subscription.id,
\t\t\tcustomerId: subscription.customerId,
\t\t\tcancelAtPeriodEnd: 0,
\t\t\t...update,
\t\t})
\t\t${conflict.subscription}
}

async function upsertPurchase(db: GuapDrizzleDatabase, purchase: Purchase): Promise<void> {
\tawait upsertCustomer(db, { id: purchase.customerId });
\tconst update = {
\t\tproductKey: purchase.productKey,
\t\tstripeCheckoutSessionId: purchase.stripeCheckoutSessionId ?? null,
\t\tstripePaymentIntentId: purchase.stripePaymentIntentId ?? null,
\t\tstatus: purchase.status,
\t\tamount: purchase.amount,
\t\tcurrency: purchase.currency,
\t\tquantity: purchase.quantity,
\t\tcompletedAt: toDatabaseTimestamp(purchase.completedAt),
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoPurchases)
\t\t.values({
\t\t\tid: purchase.id,
\t\t\tcustomerId: purchase.customerId,
\t\t\t...update,
\t\t})
\t\t${conflict.purchase}
}

async function upsertEntitlement(
\tdb: GuapDrizzleDatabase,
\tentitlement: {
\t\tcustomerId: string;
\t\tkey: string;
\t\ttype: GuapEntitlementType;
\t\tvalueBool?: boolean | null;
\t\tvalueNum?: number | null;
\t\tvalueRemaining?: number | null;
\t\tvalueLimit?: number | null;
\t\tconfig?: unknown;
\t\tresetPeriod?: "monthly" | "daily" | "weekly" | null;
\t\tlastResetAt?: string | null;
\t},
): Promise<void> {
\tawait upsertCustomer(db, { id: entitlement.customerId });
\tconst update = {
\t\ttype: entitlement.type,
\t\tvalueBool:
\t\t\tentitlement.valueBool === undefined || entitlement.valueBool === null
\t\t\t\t? null
\t\t\t\t: toFlag(entitlement.valueBool),
\t\tvalueNum: entitlement.valueNum ?? null,
\t\tvalueRemaining: entitlement.valueRemaining ?? null,
\t\tvalueLimit: entitlement.valueLimit ?? null,
\t\tconfig: stringifyJson(entitlement.config ?? {}),
\t\tresetPeriod: entitlement.resetPeriod ?? null,
\t\tlastResetAt: toDatabaseTimestamp(entitlement.lastResetAt),
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoCustomerEntitlements)
\t\t.values({
\t\t\tid: guapAdapterId("etl"),
\t\t\tcustomerId: entitlement.customerId,
\t\t\tkey: entitlement.key,
\t\t\t...update,
\t\t})
\t\t${conflict.entitlement}
}

async function upsertEntitlementSettings(
\tdb: GuapDrizzleDatabase,
\tsettings: {
\t\tcustomerId: string;
\t\tkey: string;
\t\toverageEnabled?: boolean;
\t\tpurchased?: number;
\t\tautoExpansionEnabled?: boolean;
\t},
): Promise<void> {
\tawait upsertCustomer(db, { id: settings.customerId });
\tconst update = {
\t\toverageEnabled: toFlag(settings.overageEnabled ?? false),
\t\tpurchased: settings.purchased ?? 0,
\t\tautoExpansionEnabled: toFlag(settings.autoExpansionEnabled ?? false),
\t\tupdatedAt: adapterNow(),
\t};
\tawait db
\t\t.insert(guapocadoCustomerEntitlementSettings)
\t\t.values({
\t\t\tid: guapAdapterId("ets"),
\t\t\tcustomerId: settings.customerId,
\t\t\tkey: settings.key,
\t\t\t...update,
\t\t})
\t\t${conflict.setting}
}

async function trueUpLimit(
\tdb: GuapDrizzleDatabase,
\tcustomerId: string,
\tkey: string,
\tvalue: LimitBalance,
): Promise<void> {
\tawait upsertEntitlement(db, {
\t\tcustomerId,
\t\tkey,
\t\ttype: "limit",
\t\tvalueNum: value.included,
\t\tconfig: { expansion: { allowed: value.expansionAllowed } },
\t});
\tawait upsertEntitlementSettings(db, {
\t\tcustomerId,
\t\tkey,
\t\tpurchased: value.purchased,
\t\tautoExpansionEnabled: value.autoExpansionEnabled,
\t});
}

async function trueUpUsage(
\tdb: GuapDrizzleDatabase,
\tcustomerId: string,
\tkey: string,
\tvalue: UsageBalance,
): Promise<void> {
\tawait upsertEntitlement(db, {
\t\tcustomerId,
\t\tkey,
\t\ttype: "meter",
\t\tvalueRemaining: value.overage > 0 ? -value.overage : value.balance,
\t\tvalueLimit: value.included,
\t\tconfig: {
\t\t\toverage: { allowed: value.overageAllowed },
\t\t\tresets: value.resets,
\t\t},
\t});
\tawait upsertEntitlementSettings(db, {
\t\tcustomerId,
\t\tkey,
\t\toverageEnabled: value.overageEnabled,
\t});
}

export function createGuapDrizzleAdapter(db: GuapDrizzleDatabase): GuapAdapter {
\tconst adapter: GuapAdapter = {
\t\tasync has({ customerId, key }) {
\t\t\tconst row = await findEntitlement(db, customerId, key, "feature");
\t\t\tif (!row) return { found: false, reason: "missing feature entitlement" };
\t\t\treturn { found: true, value: fromFlag(row.valueBool) };
\t\t},
\t\tasync limit({ customerId, key }) {
\t\t\tconst row = await findEntitlement(db, customerId, key, "limit");
\t\t\tif (!row) return { found: false, reason: "missing limit entitlement" };
\t\t\treturn { found: true, value: toLimitBalance(row) };
\t\t},
\t\tasync usageBalance({ customerId, key }) {
\t\t\tconst row = await findEntitlement(db, customerId, key, "meter");
\t\t\tif (!row) return { found: false, reason: "missing meter entitlement" };
\t\t\treturn { found: true, value: toUsageBalance(row) };
\t\t},
\t\tasync currentSubscription({ customerId }) {
\t\t\tconst subscription = await readCurrentSubscription(db, customerId);
\t\t\tif (subscription === undefined) return { found: false, reason: "missing subscription" };
\t\t\treturn { found: true, value: subscription };
\t\t},
\t\tasync plans() {
\t\t\tconst plans = await readPlans(db);
\t\t\tif (plans.length === 0) return { found: false, reason: "missing plans" };
\t\t\treturn { found: true, value: plans };
\t\t},
\t\tasync purchases({ customerId }) {
\t\t\tconst purchases = await readPurchases(db, customerId);
\t\t\tif (purchases.length === 0) return { found: false, reason: "missing purchases" };
\t\t\treturn { found: true, value: purchases };
\t\t},
\t\tasync context(input) {
\t\t\tconst featureKeys = input.features ?? [];
\t\t\tconst usageKeys = input.usage ?? [];
\t\t\tconst limitKeys = input.limits ?? [];
\t\t\tconst features: BillingContext["features"] = {};
\t\t\tconst usage: BillingContext["usage"] = {};
\t\t\tconst limits: BillingContext["limits"] = {};

\t\t\tfor (const key of featureKeys) {
\t\t\t\tconst result = await adapter.has?.({ customerId: input.customerId, key });
\t\t\t\tif (!result?.found) return { found: false, reason: "missing feature entitlement" };
\t\t\t\tfeatures[key] = result.value;
\t\t\t}

\t\t\tfor (const key of usageKeys) {
\t\t\t\tconst result = await adapter.usageBalance?.({ customerId: input.customerId, key });
\t\t\t\tif (!result?.found) return { found: false, reason: "missing meter entitlement" };
\t\t\t\tusage[key] = result.value;
\t\t\t}

\t\t\tfor (const key of limitKeys) {
\t\t\t\tconst result = await adapter.limit?.({ customerId: input.customerId, key });
\t\t\t\tif (!result?.found) return { found: false, reason: "missing limit entitlement" };
\t\t\t\tlimits[key] = result.value;
\t\t\t}

\t\t\tlet plans: Product[] = [];
\t\t\tif (input.includePlans ?? true) {
\t\t\t\tconst result = await adapter.plans?.();
\t\t\t\tif (!result?.found) return { found: false, reason: "missing plans" };
\t\t\t\tplans = result.value;
\t\t\t}

\t\t\tlet subscription: Subscription | null = null;
\t\t\tif (input.includeSubscription ?? true) {
\t\t\t\tconst result = await adapter.currentSubscription?.({ customerId: input.customerId });
\t\t\t\tif (!result?.found) return { found: false, reason: "missing subscription" };
\t\t\t\tsubscription = result.value;
\t\t\t}

\t\t\tconst customer =
\t\t\t\t(await findCustomer(db, input.customerId)) ??
\t\t\t\t(input.customer
\t\t\t\t\t? {
\t\t\t\t\t\t\tid: input.customerId,
\t\t\t\t\t\t\tname: input.customer.name ?? null,
\t\t\t\t\t\t\temail: input.customer.email ?? null,
\t\t\t\t\t\t}
\t\t\t\t\t: { id: input.customerId });

\t\t\treturn {
\t\t\t\tfound: true,
\t\t\t\tvalue: {
\t\t\t\t\tcustomerId: input.customerId,
\t\t\t\t\tcustomer,
\t\t\t\t\tfeatures,
\t\t\t\t\tusage,
\t\t\t\t\tlimits,
\t\t\t\t\tplans,
\t\t\t\t\tsubscription,
\t\t\t\t},
\t\t\t};
\t\t},
\t\tasync trueUp(event) {
\t\t\tif (event.operation === "has") {
\t\t\t\tawait upsertEntitlement(db, {
\t\t\t\t\tcustomerId: event.customerId,
\t\t\t\t\tkey: event.key,
\t\t\t\t\ttype: "feature",
\t\t\t\t\tvalueBool: event.value,
\t\t\t\t});
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "limit") {
\t\t\t\tawait trueUpLimit(db, event.customerId, event.key, event.value);
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "usage.balance") {
\t\t\t\tawait trueUpUsage(db, event.customerId, event.key, event.value);
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "plans.list") {
\t\t\t\tfor (const plan of event.value) {
\t\t\t\t\tawait upsertPlan(db, plan);
\t\t\t\t}
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "purchases.list") {
\t\t\t\tawait upsertCustomer(db, { id: event.customerId });
\t\t\t\tfor (const purchase of event.value) {
\t\t\t\t\tawait upsertPurchase(db, purchase);
\t\t\t\t}
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "subscription.current") {
\t\t\t\tawait upsertCustomer(db, { id: event.customerId });
\t\t\t\tawait upsertSubscription(db, event.value);
\t\t\t\treturn;
\t\t\t}
\t\t\tif (event.operation === "context") {
\t\t\t\tawait upsertCustomer(db, {
\t\t\t\t\tid: event.value.customerId,
\t\t\t\t\tname: event.value.customer?.name ?? event.input.customer?.name ?? null,
\t\t\t\t\temail: event.value.customer?.email ?? event.input.customer?.email ?? null,
\t\t\t\t\tmetadata: event.input.customer?.metadata ?? {},
\t\t\t\t});
\t\t\t\tfor (const plan of event.value.plans) {
\t\t\t\t\tawait upsertPlan(db, plan);
\t\t\t\t}
\t\t\t\tawait upsertSubscription(db, event.value.subscription);
\t\t\t\tfor (const [key, value] of Object.entries(event.value.features)) {
\t\t\t\t\tawait upsertEntitlement(db, {
\t\t\t\t\t\tcustomerId: event.value.customerId,
\t\t\t\t\t\tkey,
\t\t\t\t\t\ttype: "feature",
\t\t\t\t\t\tvalueBool: Boolean(value),
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\tfor (const [key, value] of Object.entries(event.value.usage)) {
\t\t\t\t\tawait trueUpUsage(db, event.value.customerId, key, value as UsageBalance);
\t\t\t\t}
\t\t\t\tfor (const [key, value] of Object.entries(event.value.limits)) {
\t\t\t\t\tawait trueUpLimit(db, event.value.customerId, key, value as LimitBalance);
\t\t\t\t}
\t\t\t}
\t\t},
\t};
\treturn adapter;
}
`;
}

function generateSqliteTables(): string {
	return `// Generated by guap generate --tables --orm drizzle --db sqlite
// Guapocado server SDK tables for Drizzle + SQLite/libSQL/Turso/D1.

import type { BillingContext, BillingPlan, Customer, GuapAdapter, LimitBalance, Product, Purchase, Subscription, UsageBalance } from "@guapocado/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const guapocadoCustomers = sqliteTable("guapocado_customers", {
\tid: text("id").primaryKey(),
\tstripeCustomerId: text("stripe_customer_id").unique(),
\tname: text("name"),
\temail: text("email"),
\tmetadata: text("metadata").notNull().default("{}"),
\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
});

export const guapocadoPlans = sqliteTable("guapocado_plans", {
\tid: text("id").primaryKey(),
\tkey: text("key").notNull().unique(),
\tname: text("name"),
\tconfig: text("config").notNull().default("{}"),
\tstripeProductId: text("stripe_product_id"),
\tstripePriceId: text("stripe_price_id"),
\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
});

export const guapocadoEntitlementDefinitions = sqliteTable("guapocado_entitlement_definitions", {
\tid: text("id").primaryKey(),
\tkey: text("key").notNull().unique(),
\ttype: text("type", { enum: ["feature", "meter", "limit"] }).notNull(),
\tconfig: text("config").notNull().default("{}"),
\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
});

export const guapocadoSubscriptions = sqliteTable(
\t"guapocado_subscriptions",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeSubscriptionId: text("stripe_subscription_id").unique(),
\t\tplanKey: text("plan_key").notNull(),
\t\tstatus: text("status", {
\t\t\tenum: ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete"],
\t\t}).notNull(),
\t\tcurrentPeriodStart: text("current_period_start"),
\t\tcurrentPeriodEnd: text("current_period_end"),
\t\tcancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_subscriptions_customer").on(table.customerId),
\t\tindex("idx_guapocado_subscriptions_stripe").on(table.stripeSubscriptionId),
\t],
);

export const guapocadoPurchases = sqliteTable(
\t"guapocado_purchases",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: text("product_key").notNull(),
\t\tstripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
\t\tstripePaymentIntentId: text("stripe_payment_intent_id"),
\t\tstatus: text("status", {
\t\t\tenum: ["pending", "completed", "failed", "refunded"],
\t\t}).notNull(),
\t\tamount: integer("amount").notNull().default(0),
\t\tcurrency: text("currency").notNull().default("usd"),
\t\tquantity: real("quantity").notNull().default(1),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcompletedAt: text("completed_at"),
\t\tmetadata: text("metadata").notNull().default("{}"),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchases_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchases_product").on(table.productKey),
\t\tindex("idx_guapocado_purchases_checkout").on(table.stripeCheckoutSessionId),
\t],
);

export const guapocadoPurchaseGrants = sqliteTable(
\t"guapocado_purchase_grants",
\t{
\t\tid: text("id").primaryKey(),
\t\tpurchaseId: text("purchase_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoPurchases.id, { onDelete: "cascade" }),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: text("product_key").notNull(),
\t\tentitlementKey: text("entitlement_key").notNull(),
\t\tgrantType: text("grant_type", {
\t\t\tenum: ["feature", "meter_credit", "limit_increment"],
\t\t}).notNull(),
\t\tamount: real("amount").notNull().default(0),
\t\tsourceType: text("source_type").notNull(),
\t\tsourceId: text("source_id").notNull().unique(),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchase_grants_purchase").on(table.purchaseId),
\t\tindex("idx_guapocado_purchase_grants_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchase_grants_entitlement").on(
\t\t\ttable.customerId,
\t\t\ttable.entitlementKey,
\t\t),
\t\tindex("idx_guapocado_purchase_grants_source").on(table.sourceId),
\t],
);

export const guapocadoCustomerEntitlements = sqliteTable(
\t"guapocado_customer_entitlements",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\ttype: text("type", { enum: ["feature", "meter", "limit"] }).notNull(),
\t\tvalueBool: integer("value_bool"),
\t\tvalueNum: real("value_num"),
\t\tvalueRemaining: real("value_remaining"),
\t\tvalueLimit: real("value_limit"),
\t\tconfig: text("config").notNull().default("{}"),
\t\tresetPeriod: text("reset_period", { enum: ["monthly", "daily", "weekly"] }),
\t\tlastResetAt: text("last_reset_at"),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlements_customer_key").on(table.customerId, table.key),
\t\tindex("idx_guapocado_customer_entitlements_customer").on(table.customerId),
\t],
);

export const guapocadoCustomerEntitlementSettings = sqliteTable(
\t"guapocado_customer_entitlement_settings",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\toverageEnabled: integer("overage_enabled").notNull().default(0),
\t\tpurchased: real("purchased").notNull().default(0),
\t\tautoExpansionEnabled: integer("auto_expansion_enabled").notNull().default(0),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlement_settings_customer_key").on(
\t\t\ttable.customerId,
\t\t\ttable.key,
\t\t),
\t\tindex("idx_guapocado_customer_entitlement_settings_customer").on(table.customerId),
\t],
);

export const guapocadoMeters = sqliteTable(
\t"guapocado_meters",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\taggregation: text("aggregation", {
\t\t\tenum: ["count", "sum", "average", "min", "max", "unique"],
\t\t}).notNull(),
\t\tcurrentValue: real("current_value").notNull().default(0),
\t\tperiodStart: text("period_start"),
\t\tperiodEnd: text("period_end"),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [uniqueIndex("guapocado_meters_customer_key").on(table.customerId, table.key)],
);

export const guapocadoUsageEvents = sqliteTable(
\t"guapocado_usage_events",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tname: text("name").notNull(),
\t\tvalue: real("value").notNull(),
\t\tidempotencyKey: text("idempotency_key").unique(),
\t\ttimestamp: text("timestamp").notNull().default(sql\`(datetime('now'))\`),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_usage_events_customer").on(table.customerId),
\t\tindex("idx_guapocado_usage_events_name").on(table.customerId, table.name),
\t\tindex("idx_guapocado_usage_events_idempotency").on(table.idempotencyKey),
\t],
);

export const guapocadoInvoices = sqliteTable(
\t"guapocado_invoices",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeInvoiceId: text("stripe_invoice_id").unique(),
\t\tsubscriptionId: text("subscription_id").references(() => guapocadoSubscriptions.id),
\t\tstatus: text("status", {
\t\t\tenum: ["draft", "open", "paid", "void", "uncollectible"],
\t\t}).notNull(),
\t\tamountDue: integer("amount_due").notNull().default(0),
\t\tamountPaid: integer("amount_paid").notNull().default(0),
\t\tcurrency: text("currency").notNull().default("usd"),
\t\tperiodStart: text("period_start"),
\t\tperiodEnd: text("period_end"),
\t\thostedInvoiceUrl: text("hosted_invoice_url"),
\t\tpdfUrl: text("pdf_url"),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_invoices_customer").on(table.customerId),
\t\tindex("idx_guapocado_invoices_stripe").on(table.stripeInvoiceId),
\t],
);

export const guapocadoOverages = sqliteTable(
\t"guapocado_overages",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tmeterKey: text("meter_key").notNull(),
\t\tamount: real("amount").notNull(),
\t\tperiodStart: text("period_start").notNull(),
\t\tperiodEnd: text("period_end").notNull(),
\t\tbilled: integer("billed").notNull().default(0),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [index("idx_guapocado_overages_customer").on(table.customerId)],
);

export const guapocadoWebhookEvents = sqliteTable(
\t"guapocado_webhook_events",
\t{
\t\tid: text("id").primaryKey(),
\t\tstripeEventId: text("stripe_event_id").unique(),
\t\tsourceType: text("source_type"),
\t\tsourceId: text("source_id"),
\t\tsourceEventId: text("source_event_id"),
\t\ttype: text("type").notNull(),
\t\tpayload: text("payload").notNull(),
\t\tstatus: text("status", { enum: ["pending", "processed", "failed"] }).notNull(),
\t\terror: text("error"),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t\tprocessedAt: text("processed_at"),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_events_stripe").on(table.stripeEventId),
\t\tindex("idx_guapocado_webhook_events_source").on(table.sourceType, table.sourceId),
\t\tindex("idx_guapocado_webhook_events_source_event").on(table.sourceEventId),
\t],
);

export const guapocadoWebhookEndpoints = sqliteTable("guapocado_webhook_endpoints", {
\tid: text("id").primaryKey(),
\turl: text("url").notNull(),
\tdescription: text("description"),
\teventTypes: text("event_types").notNull().default("*"),
\tregistrationKey: text("registration_key").unique(),
\tsigningSecret: text("signing_secret").notNull(),
\tenabled: integer("enabled").notNull().default(1),
\tdeletedAt: text("deleted_at"),
\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\tupdatedAt: text("updated_at").notNull().default(sql\`(datetime('now'))\`),
});

export const guapocadoWebhookDeliveries = sqliteTable(
\t"guapocado_webhook_deliveries",
\t{
\t\tid: text("id").primaryKey(),
\t\twebhookEventId: text("webhook_event_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEvents.id, { onDelete: "cascade" }),
\t\tendpointId: text("endpoint_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEndpoints.id, { onDelete: "cascade" }),
\t\tstatus: text("status", {
\t\t\tenum: ["pending", "delivered", "failed", "retrying"],
\t\t}).notNull(),
\t\tattempts: integer("attempts").notNull().default(0),
\t\tlastAttemptAt: text("last_attempt_at"),
\t\tnextRetryAt: text("next_retry_at"),
\t\tresponseStatus: integer("response_status"),
\t\tresponseBody: text("response_body"),
\t\tcreatedAt: text("created_at").notNull().default(sql\`(datetime('now'))\`),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_deliveries_event").on(table.webhookEventId),
\t\tindex("idx_guapocado_webhook_deliveries_endpoint").on(table.endpointId),
\t],
);
${generateDrizzleAdapter("sqlite")}
`;
}

function generatePostgresTables(): string {
	return `// Generated by guap generate --tables --orm drizzle --db pg
// Guapocado server SDK tables for Drizzle + PostgreSQL.

import type { BillingContext, BillingPlan, Customer, GuapAdapter, LimitBalance, Product, Purchase, Subscription, UsageBalance } from "@guapocado/sdk";
import { and, desc, eq } from "drizzle-orm";
import { index, integer, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedNow = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const guapocadoCustomers = pgTable("guapocado_customers", {
\tid: text("id").primaryKey(),
\tstripeCustomerId: text("stripe_customer_id").unique(),
\tname: text("name"),
\temail: text("email"),
\tmetadata: text("metadata").notNull().default("{}"),
\tcreatedAt: now(),
\tupdatedAt: updatedNow(),
});

export const guapocadoPlans = pgTable("guapocado_plans", {
\tid: text("id").primaryKey(),
\tkey: text("key").notNull().unique(),
\tname: text("name"),
\tconfig: text("config").notNull().default("{}"),
\tstripeProductId: text("stripe_product_id"),
\tstripePriceId: text("stripe_price_id"),
\tcreatedAt: now(),
\tupdatedAt: updatedNow(),
});

export const guapocadoEntitlementDefinitions = pgTable("guapocado_entitlement_definitions", {
\tid: text("id").primaryKey(),
\tkey: text("key").notNull().unique(),
\ttype: text("type", { enum: ["feature", "meter", "limit"] }).notNull(),
\tconfig: text("config").notNull().default("{}"),
\tcreatedAt: now(),
\tupdatedAt: updatedNow(),
});

export const guapocadoSubscriptions = pgTable(
\t"guapocado_subscriptions",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeSubscriptionId: text("stripe_subscription_id").unique(),
\t\tplanKey: text("plan_key").notNull(),
\t\tstatus: text("status", {
\t\t\tenum: ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete"],
\t\t}).notNull(),
\t\tcurrentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
\t\tcurrentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
\t\tcancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_subscriptions_customer").on(table.customerId),
\t\tindex("idx_guapocado_subscriptions_stripe").on(table.stripeSubscriptionId),
\t],
);

export const guapocadoPurchases = pgTable(
\t"guapocado_purchases",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: text("product_key").notNull(),
\t\tstripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
\t\tstripePaymentIntentId: text("stripe_payment_intent_id"),
\t\tstatus: text("status", {
\t\t\tenum: ["pending", "completed", "failed", "refunded"],
\t\t}).notNull(),
\t\tamount: integer("amount").notNull().default(0),
\t\tcurrency: text("currency").notNull().default("usd"),
\t\tquantity: real("quantity").notNull().default(1),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcompletedAt: timestamp("completed_at", { withTimezone: true }),
\t\tmetadata: text("metadata").notNull().default("{}"),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchases_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchases_product").on(table.productKey),
\t\tindex("idx_guapocado_purchases_checkout").on(table.stripeCheckoutSessionId),
\t],
);

export const guapocadoPurchaseGrants = pgTable(
\t"guapocado_purchase_grants",
\t{
\t\tid: text("id").primaryKey(),
\t\tpurchaseId: text("purchase_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoPurchases.id, { onDelete: "cascade" }),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: text("product_key").notNull(),
\t\tentitlementKey: text("entitlement_key").notNull(),
\t\tgrantType: text("grant_type", {
\t\t\tenum: ["feature", "meter_credit", "limit_increment"],
\t\t}).notNull(),
\t\tamount: real("amount").notNull().default(0),
\t\tsourceType: text("source_type").notNull(),
\t\tsourceId: text("source_id").notNull().unique(),
\t\tcreatedAt: now(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchase_grants_purchase").on(table.purchaseId),
\t\tindex("idx_guapocado_purchase_grants_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchase_grants_entitlement").on(
\t\t\ttable.customerId,
\t\t\ttable.entitlementKey,
\t\t),
\t\tindex("idx_guapocado_purchase_grants_source").on(table.sourceId),
\t],
);

export const guapocadoCustomerEntitlements = pgTable(
\t"guapocado_customer_entitlements",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\ttype: text("type", { enum: ["feature", "meter", "limit"] }).notNull(),
\t\tvalueBool: integer("value_bool"),
\t\tvalueNum: real("value_num"),
\t\tvalueRemaining: real("value_remaining"),
\t\tvalueLimit: real("value_limit"),
\t\tconfig: text("config").notNull().default("{}"),
\t\tresetPeriod: text("reset_period", { enum: ["monthly", "daily", "weekly"] }),
\t\tlastResetAt: timestamp("last_reset_at", { withTimezone: true }),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlements_customer_key").on(table.customerId, table.key),
\t\tindex("idx_guapocado_customer_entitlements_customer").on(table.customerId),
\t],
);

export const guapocadoCustomerEntitlementSettings = pgTable(
\t"guapocado_customer_entitlement_settings",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\toverageEnabled: integer("overage_enabled").notNull().default(0),
\t\tpurchased: real("purchased").notNull().default(0),
\t\tautoExpansionEnabled: integer("auto_expansion_enabled").notNull().default(0),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlement_settings_customer_key").on(
\t\t\ttable.customerId,
\t\t\ttable.key,
\t\t),
\t\tindex("idx_guapocado_customer_entitlement_settings_customer").on(table.customerId),
\t],
);

export const guapocadoMeters = pgTable(
\t"guapocado_meters",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: text("key").notNull(),
\t\taggregation: text("aggregation", {
\t\t\tenum: ["count", "sum", "average", "min", "max", "unique"],
\t\t}).notNull(),
\t\tcurrentValue: real("current_value").notNull().default(0),
\t\tperiodStart: timestamp("period_start", { withTimezone: true }),
\t\tperiodEnd: timestamp("period_end", { withTimezone: true }),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [uniqueIndex("guapocado_meters_customer_key").on(table.customerId, table.key)],
);

export const guapocadoUsageEvents = pgTable(
\t"guapocado_usage_events",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tname: text("name").notNull(),
\t\tvalue: real("value").notNull(),
\t\tidempotencyKey: text("idempotency_key").unique(),
\t\ttimestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
\t\tcreatedAt: now(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_usage_events_customer").on(table.customerId),
\t\tindex("idx_guapocado_usage_events_name").on(table.customerId, table.name),
\t\tindex("idx_guapocado_usage_events_idempotency").on(table.idempotencyKey),
\t],
);

export const guapocadoInvoices = pgTable(
\t"guapocado_invoices",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeInvoiceId: text("stripe_invoice_id").unique(),
\t\tsubscriptionId: text("subscription_id").references(() => guapocadoSubscriptions.id),
\t\tstatus: text("status", {
\t\t\tenum: ["draft", "open", "paid", "void", "uncollectible"],
\t\t}).notNull(),
\t\tamountDue: integer("amount_due").notNull().default(0),
\t\tamountPaid: integer("amount_paid").notNull().default(0),
\t\tcurrency: text("currency").notNull().default("usd"),
\t\tperiodStart: timestamp("period_start", { withTimezone: true }),
\t\tperiodEnd: timestamp("period_end", { withTimezone: true }),
\t\thostedInvoiceUrl: text("hosted_invoice_url"),
\t\tpdfUrl: text("pdf_url"),
\t\tsourceEventCreated: integer("source_event_created").notNull().default(0),
\t\tcreatedAt: now(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_invoices_customer").on(table.customerId),
\t\tindex("idx_guapocado_invoices_stripe").on(table.stripeInvoiceId),
\t],
);

export const guapocadoOverages = pgTable(
\t"guapocado_overages",
\t{
\t\tid: text("id").primaryKey(),
\t\tcustomerId: text("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tmeterKey: text("meter_key").notNull(),
\t\tamount: real("amount").notNull(),
\t\tperiodStart: timestamp("period_start", { withTimezone: true }).notNull(),
\t\tperiodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
\t\tbilled: integer("billed").notNull().default(0),
\t\tcreatedAt: now(),
\t},
\t(table) => [index("idx_guapocado_overages_customer").on(table.customerId)],
);

export const guapocadoWebhookEvents = pgTable(
\t"guapocado_webhook_events",
\t{
\t\tid: text("id").primaryKey(),
\t\tstripeEventId: text("stripe_event_id").unique(),
\t\tsourceType: text("source_type"),
\t\tsourceId: text("source_id"),
\t\tsourceEventId: text("source_event_id"),
\t\ttype: text("type").notNull(),
\t\tpayload: text("payload").notNull(),
\t\tstatus: text("status", { enum: ["pending", "processed", "failed"] }).notNull(),
\t\terror: text("error"),
\t\tcreatedAt: now(),
\t\tprocessedAt: timestamp("processed_at", { withTimezone: true }),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_events_stripe").on(table.stripeEventId),
\t\tindex("idx_guapocado_webhook_events_source").on(table.sourceType, table.sourceId),
\t\tindex("idx_guapocado_webhook_events_source_event").on(table.sourceEventId),
\t],
);

export const guapocadoWebhookEndpoints = pgTable("guapocado_webhook_endpoints", {
\tid: text("id").primaryKey(),
\turl: text("url").notNull(),
\tdescription: text("description"),
\teventTypes: text("event_types").notNull().default("*"),
\tregistrationKey: text("registration_key").unique(),
\tsigningSecret: text("signing_secret").notNull(),
\tenabled: integer("enabled").notNull().default(1),
\tdeletedAt: timestamp("deleted_at", { withTimezone: true }),
\tcreatedAt: now(),
\tupdatedAt: updatedNow(),
});

export const guapocadoWebhookDeliveries = pgTable(
\t"guapocado_webhook_deliveries",
\t{
\t\tid: text("id").primaryKey(),
\t\twebhookEventId: text("webhook_event_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEvents.id, { onDelete: "cascade" }),
\t\tendpointId: text("endpoint_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEndpoints.id, { onDelete: "cascade" }),
\t\tstatus: text("status", {
\t\t\tenum: ["pending", "delivered", "failed", "retrying"],
\t\t}).notNull(),
\t\tattempts: integer("attempts").notNull().default(0),
\t\tlastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
\t\tnextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
\t\tresponseStatus: integer("response_status"),
\t\tresponseBody: text("response_body"),
\t\tcreatedAt: now(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_deliveries_event").on(table.webhookEventId),
\t\tindex("idx_guapocado_webhook_deliveries_endpoint").on(table.endpointId),
\t],
);
${generateDrizzleAdapter("pg")}
`;
}

function generateMysqlTables(): string {
	return `// Generated by guap generate --tables --orm drizzle --db mysql
// Guapocado server SDK tables for Drizzle + MySQL/PlanetScale/MariaDB.

import type { BillingContext, BillingPlan, Customer, GuapAdapter, LimitBalance, Product, Purchase, Subscription, UsageBalance } from "@guapocado/sdk";
import { and, desc, eq } from "drizzle-orm";
import { double, index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const id = (name: string) => varchar(name, { length: 191 });
const shortText = (name: string) => varchar(name, { length: 255 });
const jsonText = (name: string) => varchar(name, { length: 4096 }).notNull().default("{}");
const createdNow = () => timestamp("created_at").notNull().defaultNow();
const updatedNow = () => timestamp("updated_at").notNull().defaultNow();

export const guapocadoCustomers = mysqlTable("guapocado_customers", {
\tid: id("id").primaryKey(),
\tstripeCustomerId: shortText("stripe_customer_id").unique(),
\tname: text("name"),
\temail: shortText("email"),
\tmetadata: jsonText("metadata"),
\tcreatedAt: createdNow(),
\tupdatedAt: updatedNow(),
});

export const guapocadoPlans = mysqlTable("guapocado_plans", {
\tid: id("id").primaryKey(),
\tkey: shortText("key").notNull().unique(),
\tname: text("name"),
\tconfig: jsonText("config"),
\tstripeProductId: shortText("stripe_product_id"),
\tstripePriceId: shortText("stripe_price_id"),
\tcreatedAt: createdNow(),
\tupdatedAt: updatedNow(),
});

export const guapocadoEntitlementDefinitions = mysqlTable("guapocado_entitlement_definitions", {
\tid: id("id").primaryKey(),
\tkey: shortText("key").notNull().unique(),
\ttype: shortText("type").notNull(),
\tconfig: jsonText("config"),
\tcreatedAt: createdNow(),
\tupdatedAt: updatedNow(),
});

export const guapocadoSubscriptions = mysqlTable(
\t"guapocado_subscriptions",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeSubscriptionId: shortText("stripe_subscription_id").unique(),
\t\tplanKey: shortText("plan_key").notNull(),
\t\tstatus: shortText("status").notNull(),
\t\tcurrentPeriodStart: timestamp("current_period_start"),
\t\tcurrentPeriodEnd: timestamp("current_period_end"),
\t\tcancelAtPeriodEnd: int("cancel_at_period_end").notNull().default(0),
\t\tsourceEventCreated: int("source_event_created").notNull().default(0),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_subscriptions_customer").on(table.customerId),
\t\tindex("idx_guapocado_subscriptions_stripe").on(table.stripeSubscriptionId),
\t],
);

export const guapocadoPurchases = mysqlTable(
\t"guapocado_purchases",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: shortText("product_key").notNull(),
\t\tstripeCheckoutSessionId: shortText("stripe_checkout_session_id").unique(),
\t\tstripePaymentIntentId: shortText("stripe_payment_intent_id"),
\t\tstatus: shortText("status").notNull(),
\t\tamount: int("amount").notNull().default(0),
\t\tcurrency: shortText("currency").notNull().default("usd"),
\t\tquantity: double("quantity").notNull().default(1),
\t\tsourceEventCreated: int("source_event_created").notNull().default(0),
\t\tcompletedAt: timestamp("completed_at"),
\t\tmetadata: jsonText("metadata"),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchases_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchases_product").on(table.productKey),
\t\tindex("idx_guapocado_purchases_checkout").on(table.stripeCheckoutSessionId),
\t],
);

export const guapocadoPurchaseGrants = mysqlTable(
\t"guapocado_purchase_grants",
\t{
\t\tid: id("id").primaryKey(),
\t\tpurchaseId: id("purchase_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoPurchases.id, { onDelete: "cascade" }),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tproductKey: shortText("product_key").notNull(),
\t\tentitlementKey: shortText("entitlement_key").notNull(),
\t\tgrantType: shortText("grant_type").notNull(),
\t\tamount: double("amount").notNull().default(0),
\t\tsourceType: shortText("source_type").notNull(),
\t\tsourceId: shortText("source_id").notNull().unique(),
\t\tcreatedAt: createdNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_purchase_grants_purchase").on(table.purchaseId),
\t\tindex("idx_guapocado_purchase_grants_customer").on(table.customerId),
\t\tindex("idx_guapocado_purchase_grants_entitlement").on(
\t\t\ttable.customerId,
\t\t\ttable.entitlementKey,
\t\t),
\t\tindex("idx_guapocado_purchase_grants_source").on(table.sourceId),
\t],
);

export const guapocadoCustomerEntitlements = mysqlTable(
\t"guapocado_customer_entitlements",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: shortText("key").notNull(),
\t\ttype: shortText("type").notNull(),
\t\tvalueBool: int("value_bool"),
\t\tvalueNum: double("value_num"),
\t\tvalueRemaining: double("value_remaining"),
\t\tvalueLimit: double("value_limit"),
\t\tconfig: jsonText("config"),
\t\tresetPeriod: shortText("reset_period"),
\t\tlastResetAt: timestamp("last_reset_at"),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlements_customer_key").on(table.customerId, table.key),
\t\tindex("idx_guapocado_customer_entitlements_customer").on(table.customerId),
\t],
);

export const guapocadoCustomerEntitlementSettings = mysqlTable(
\t"guapocado_customer_entitlement_settings",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: shortText("key").notNull(),
\t\toverageEnabled: int("overage_enabled").notNull().default(0),
\t\tpurchased: double("purchased").notNull().default(0),
\t\tautoExpansionEnabled: int("auto_expansion_enabled").notNull().default(0),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tuniqueIndex("guapocado_customer_entitlement_settings_customer_key").on(
\t\t\ttable.customerId,
\t\t\ttable.key,
\t\t),
\t\tindex("idx_guapocado_customer_entitlement_settings_customer").on(table.customerId),
\t],
);

export const guapocadoMeters = mysqlTable(
\t"guapocado_meters",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tkey: shortText("key").notNull(),
\t\taggregation: shortText("aggregation").notNull(),
\t\tcurrentValue: double("current_value").notNull().default(0),
\t\tperiodStart: timestamp("period_start"),
\t\tperiodEnd: timestamp("period_end"),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [uniqueIndex("guapocado_meters_customer_key").on(table.customerId, table.key)],
);

export const guapocadoUsageEvents = mysqlTable(
\t"guapocado_usage_events",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tname: shortText("name").notNull(),
\t\tvalue: double("value").notNull(),
\t\tidempotencyKey: shortText("idempotency_key").unique(),
\t\ttimestamp: timestamp("timestamp").notNull().defaultNow(),
\t\tcreatedAt: createdNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_usage_events_customer").on(table.customerId),
\t\tindex("idx_guapocado_usage_events_name").on(table.customerId, table.name),
\t\tindex("idx_guapocado_usage_events_idempotency").on(table.idempotencyKey),
\t],
);

export const guapocadoInvoices = mysqlTable(
\t"guapocado_invoices",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tstripeInvoiceId: shortText("stripe_invoice_id").unique(),
\t\tsubscriptionId: id("subscription_id").references(() => guapocadoSubscriptions.id),
\t\tstatus: shortText("status").notNull(),
\t\tamountDue: int("amount_due").notNull().default(0),
\t\tamountPaid: int("amount_paid").notNull().default(0),
\t\tcurrency: shortText("currency").notNull().default("usd"),
\t\tperiodStart: timestamp("period_start"),
\t\tperiodEnd: timestamp("period_end"),
\t\thostedInvoiceUrl: text("hosted_invoice_url"),
\t\tpdfUrl: text("pdf_url"),
\t\tsourceEventCreated: int("source_event_created").notNull().default(0),
\t\tcreatedAt: createdNow(),
\t\tupdatedAt: updatedNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_invoices_customer").on(table.customerId),
\t\tindex("idx_guapocado_invoices_stripe").on(table.stripeInvoiceId),
\t],
);

export const guapocadoOverages = mysqlTable(
\t"guapocado_overages",
\t{
\t\tid: id("id").primaryKey(),
\t\tcustomerId: id("customer_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoCustomers.id, { onDelete: "cascade" }),
\t\tmeterKey: shortText("meter_key").notNull(),
\t\tamount: double("amount").notNull(),
\t\tperiodStart: timestamp("period_start").notNull(),
\t\tperiodEnd: timestamp("period_end").notNull(),
\t\tbilled: int("billed").notNull().default(0),
\t\tcreatedAt: createdNow(),
\t},
\t(table) => [index("idx_guapocado_overages_customer").on(table.customerId)],
);

export const guapocadoWebhookEvents = mysqlTable(
\t"guapocado_webhook_events",
\t{
\t\tid: id("id").primaryKey(),
\t\tstripeEventId: shortText("stripe_event_id").unique(),
\t\tsourceType: shortText("source_type"),
\t\tsourceId: shortText("source_id"),
\t\tsourceEventId: shortText("source_event_id"),
\t\ttype: shortText("type").notNull(),
\t\tpayload: text("payload").notNull(),
\t\tstatus: shortText("status").notNull(),
\t\terror: text("error"),
\t\tcreatedAt: createdNow(),
\t\tprocessedAt: timestamp("processed_at"),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_events_stripe").on(table.stripeEventId),
\t\tindex("idx_guapocado_webhook_events_source").on(table.sourceType, table.sourceId),
\t\tindex("idx_guapocado_webhook_events_source_event").on(table.sourceEventId),
\t],
);

export const guapocadoWebhookEndpoints = mysqlTable("guapocado_webhook_endpoints", {
\tid: id("id").primaryKey(),
\turl: text("url").notNull(),
\tdescription: text("description"),
\teventTypes: text("event_types").notNull().default("*"),
\tregistrationKey: shortText("registration_key").unique(),
\tsigningSecret: shortText("signing_secret").notNull(),
\tenabled: int("enabled").notNull().default(1),
\tdeletedAt: timestamp("deleted_at"),
\tcreatedAt: createdNow(),
\tupdatedAt: updatedNow(),
});

export const guapocadoWebhookDeliveries = mysqlTable(
\t"guapocado_webhook_deliveries",
\t{
\t\tid: id("id").primaryKey(),
\t\twebhookEventId: id("webhook_event_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEvents.id, { onDelete: "cascade" }),
\t\tendpointId: id("endpoint_id")
\t\t\t.notNull()
\t\t\t.references(() => guapocadoWebhookEndpoints.id, { onDelete: "cascade" }),
\t\tstatus: shortText("status").notNull(),
\t\tattempts: int("attempts").notNull().default(0),
\t\tlastAttemptAt: timestamp("last_attempt_at"),
\t\tnextRetryAt: timestamp("next_retry_at"),
\t\tresponseStatus: int("response_status"),
\t\tresponseBody: text("response_body"),
\t\tcreatedAt: createdNow(),
\t},
\t(table) => [
\t\tindex("idx_guapocado_webhook_deliveries_event").on(table.webhookEventId),
\t\tindex("idx_guapocado_webhook_deliveries_endpoint").on(table.endpointId),
\t],
);
${generateDrizzleAdapter("mysql")}
`;
}
