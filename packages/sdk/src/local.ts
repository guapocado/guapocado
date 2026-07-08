import { GUAPOCADO_DOMAIN_EVENTS } from "@guapocado/shared";
import {
	type GuapAdapter,
	type GuapAdapterResult,
	type GuapAdapterTrueUpEvent,
	type GuapocadoClient,
	type GuapocadoClientOptions,
	GuapocadoValidationError,
	type LimitBalance,
	type Product,
	type Purchase,
	type PurchaseStatus,
	type Subscription,
	type SubscriptionStatus,
	type UsageBalance,
	createGuapocadoClient,
} from "./client.js";

/**
 * One record stored by a {@link GuapStore} implementation: a JSON-serializable
 * value plus the two timestamps the local read model needs to resolve
 * conflicts and staleness. `sourceTs` is the event/API timestamp used for
 * last-write-wins ordering; `writtenAt` is the wall-clock time of the local
 * write, used only to decide whether a record is too stale to serve.
 */
export type GuapStoreRecord = {
	/** JSON-serializable payload. Shape depends on the collection (see the sdk README's projection table). */
	value: unknown;
	/** Source timestamp (ms epoch) used for last-write-wins conflict resolution. */
	sourceTs: number;
	/** Wall-clock write time (ms epoch), used to evaluate `maxAgeMs` staleness. */
	writtenAt: number;
};

/**
 * Minimal storage contract the local read model needs: point get/put/delete
 * plus a customer-scoped prefix scan. Implement this over any key-value or
 * SQL store (D1, better-sqlite3, Postgres, Redis, an in-memory Map) to give
 * `createGuapLocal` durable, customer-scoped storage. Collections are opaque
 * string namespaces (`"customers"`, `"subscriptions"`, `"purchases"`, …); ids
 * within a collection are `encodeURIComponent`-sanitized components joined by
 * `:`, so every customer-scoped lookup is a `<customerId>:` prefix scan — one
 * `LIKE`/range query on any backend, with no secondary index to register.
 */
export type GuapStore = {
	/** Reads one record, or `null` if the collection/id has never been written. */
	get(collection: string, id: string): Promise<GuapStoreRecord | null>;
	/** Upserts a record, overwriting whatever was previously stored at this id. */
	put(collection: string, id: string, record: GuapStoreRecord): Promise<void>;
	/** Removes a record. A no-op if the id was never written. */
	delete(collection: string, id: string): Promise<void>;
	/** Lists every record in `collection` whose id starts with `idPrefix` (customer-scoped lookups; keys are prefix-friendly). */
	listByPrefix(
		collection: string,
		idPrefix: string,
	): Promise<Array<{ id: string; record: GuapStoreRecord }>>;
};

/**
 * The domain event envelope Guapocado forwards to registered webhook
 * endpoints: a stable event id (for dedup), the domain event type, an ISO
 * timestamp used for last-write-wins ordering, the type-specific `data`
 * payload, and provenance metadata about the underlying Stripe or Guapocado
 * event that produced it. `type` is left as `string` (rather than the
 * canonical union) so forward-compatible/future event types still parse;
 * narrow `data` per hook via {@link GuapHookContext}.
 */
export type GuapDomainEventEnvelope = {
	/** Stable event id (`evt_...`), used for delivery dedup. */
	id: string;
	/** Domain event type, e.g. `"customer.updated"`. Unknown/future types are preserved, not rejected. */
	type: string;
	/** ISO 8601 event timestamp; `Date.parse`d as the last-write-wins source timestamp. */
	createdAt: string;
	/** Type-specific payload — see the sdk README's event catalog or the `Guap*UpdatedData` types. */
	data: unknown;
	/** Provenance of the underlying platform event. */
	source: {
		provider: "stripe" | "guapocado";
		eventId?: string;
		objectId?: string;
		objectType?: string;
	};
};

/** Data payload of a `customer.updated` domain event. */
export type GuapCustomerUpdatedData = {
	customer: {
		id: string;
		stripeCustomerId?: string | null;
		name?: string | null;
		email?: string | null;
		/** Parsed leniently from the platform's JSON-string metadata; the raw string if parsing fails. */
		metadata: unknown;
		createdAt?: string;
		updatedAt?: string;
	};
};

/** Data payload of a `subscription.updated` domain event. */
export type GuapSubscriptionUpdatedData = {
	subscription: {
		id: string;
		customerId: string;
		stripeSubscriptionId?: string | null;
		planKey: string;
		status: SubscriptionStatus;
		currentPeriodStart: string;
		currentPeriodEnd: string;
		cancelAtPeriodEnd: boolean;
	};
};

/** One entitlement grant applied by a completed purchase (feature unlock, meter credit, or limit increment). */
export type GuapPurchaseGrant = {
	entitlementKey: string;
	grantType: "feature" | "meter_credit" | "limit_increment";
	amount: number;
};

/** Snapshot of a one-time purchase, shared by `purchase.completed` and `purchase.updated` events. */
export type GuapPurchaseSnapshot = {
	id: string;
	customerId: string;
	productKey: string;
	stripeCheckoutSessionId?: string | null;
	stripePaymentIntentId?: string | null;
	status: PurchaseStatus;
	amount: number;
	currency: string;
	quantity: number;
	completedAt?: string | null;
};

/** Data payload of a `purchase.completed` domain event, including the entitlement grants it applied. */
export type GuapPurchaseCompletedData = {
	purchase: GuapPurchaseSnapshot;
	grants: GuapPurchaseGrant[];
};

/** Data payload of a `purchase.updated` domain event (same snapshot as completion, without grants). */
export type GuapPurchaseUpdatedData = {
	purchase: GuapPurchaseSnapshot;
};

/**
 * Data payload of an `entitlements.updated` domain event: an invalidation
 * signal only (no computed balances) fired after a purchase grants
 * entitlements or a subscription changes plan.
 */
export type GuapEntitlementsUpdatedData =
	| {
			customerId: string;
			reason: "purchase.completed";
			purchaseId: string;
			productKey: string;
			grants: GuapPurchaseGrant[];
	  }
	| {
			customerId: string;
			reason: "subscription.updated";
			subscriptionId: string;
			productKey: string;
	  };

/** Data payload of an `invoice.updated` domain event. */
export type GuapInvoiceUpdatedData = {
	invoice: {
		id: string;
		customerId: string;
		stripeInvoiceId?: string | null;
		subscriptionId?: string | null;
		status: string;
		amountDue: number;
		amountPaid: number;
		currency: string;
		periodStart?: string | null;
		periodEnd?: string | null;
		hostedInvoiceUrl?: string | null;
		pdfUrl?: string | null;
	};
};

/**
 * Context passed to a webhook hook. `event`/`data` are typed per hook (see
 * {@link GuapWebhookHooks}); `client` is the live `@guapocado/sdk` client so a
 * hook can make follow-up API calls (send a receipt, look up audit history)
 * instead of polling. `customerId` is best-effort extracted from the event
 * payload and is `null` when the event carries none.
 */
export type GuapHookContext<TData = unknown> = {
	event: GuapDomainEventEnvelope & { data: TData };
	customerId: string | null;
	data: TData;
	client: GuapocadoClient;
};

/**
 * Context passed to `onSubscribe`: fires when a customer transitions from no
 * subscription (or a non-active one) into an active subscription. `previous`
 * is the prior stored subscription snapshot, or `null` when none was on file.
 */
export type GuapSubscribeHookContext = GuapHookContext<GuapSubscriptionUpdatedData> & {
	subscription: GuapSubscriptionUpdatedData["subscription"];
	previous: GuapSubscriptionUpdatedData["subscription"] | null;
};

/**
 * Context passed to `onCancel`: fires when a subscription transitions into
 * `"canceled"` from any other status. `previous` is the prior stored
 * subscription snapshot, or `null` when none was on file (a first-ever event
 * that already reports `"canceled"` still fires this hook).
 */
export type GuapCancelHookContext = GuapHookContext<GuapSubscriptionUpdatedData> & {
	subscription: GuapSubscriptionUpdatedData["subscription"];
	previous: GuapSubscriptionUpdatedData["subscription"] | null;
};

/**
 * Context passed to `onPlanChange`: fires when a stored subscription exists
 * and its `planKey` differs from the incoming one. `previous` is always
 * present — without a prior record there is nothing to compare against, so
 * the hook does not fire.
 */
export type GuapPlanChangeHookContext = GuapHookContext<GuapSubscriptionUpdatedData> & {
	subscription: GuapSubscriptionUpdatedData["subscription"];
	previous: GuapSubscriptionUpdatedData["subscription"];
};

/**
 * Context passed to `onPurchase`, a semantic alias for `purchase.completed`
 * that surfaces the purchase snapshot and its entitlement grants directly on
 * `ctx` alongside the raw event.
 */
export type GuapPurchaseHookContext = GuapHookContext<GuapPurchaseCompletedData> & {
	purchase: GuapPurchaseSnapshot;
	grants: GuapPurchaseGrant[];
};

/**
 * Webhook hooks fired by `guap.handler()` after a delivered event is verified
 * and projected. Three tiers, all optional, all `(ctx) => void | Promise<void>`:
 * a catch-all `onEvent` for every event (including unknown/future types); raw
 * per-event hooks (`onCustomerUpdated`, `onSubscriptionUpdated`, …) typed to
 * the event's `data` shape; and semantic transition hooks (`onSubscribe`,
 * `onCancel`, `onPlanChange`, `onPurchase`) derived from the previously
 * stored record, so "did this customer just subscribe/cancel/upgrade" needs
 * no polling or diffing in your own code.
 *
 * Hooks run **after** projection but **before** the dedup marker is written,
 * so a throwing hook causes a 500 and the platform's at-least-once retry will
 * re-fire it — write hooks to be idempotent (e.g. dedupe outbound emails by
 * `event.id`).
 */
export type GuapWebhookHooks = {
	/** Fires for every verified, projected event, including unknown/future types. */
	onEvent?: (ctx: GuapHookContext<unknown>) => void | Promise<void>;
	onCustomerUpdated?: (ctx: GuapHookContext<GuapCustomerUpdatedData>) => void | Promise<void>;
	onSubscriptionUpdated?: (
		ctx: GuapHookContext<GuapSubscriptionUpdatedData>,
	) => void | Promise<void>;
	onPurchaseCompleted?: (ctx: GuapHookContext<GuapPurchaseCompletedData>) => void | Promise<void>;
	onPurchaseUpdated?: (ctx: GuapHookContext<GuapPurchaseUpdatedData>) => void | Promise<void>;
	onEntitlementsUpdated?: (
		ctx: GuapHookContext<GuapEntitlementsUpdatedData>,
	) => void | Promise<void>;
	onInvoiceUpdated?: (ctx: GuapHookContext<GuapInvoiceUpdatedData>) => void | Promise<void>;
	/** A customer transitioned from no/non-active subscription into an active one. */
	onSubscribe?: (ctx: GuapSubscribeHookContext) => void | Promise<void>;
	/** A subscription transitioned into `"canceled"`. */
	onCancel?: (ctx: GuapCancelHookContext) => void | Promise<void>;
	/** A customer's `planKey` changed on an existing subscription. */
	onPlanChange?: (ctx: GuapPlanChangeHookContext) => void | Promise<void>;
	/** Alias for `purchase.completed`, with the purchase and its grants surfaced directly on `ctx`. */
	onPurchase?: (ctx: GuapPurchaseHookContext) => void | Promise<void>;
};

/**
 * Options accepted by {@link createGuapLocal}. Only `apiKey` is required —
 * everything else has a sensible default (an in-memory store, no staleness
 * window, `"*"` webhook events, auto-registration on first use).
 */
export type GuapLocalOptions = {
	apiKey: string;
	apiUrl?: string;
	/** Backing storage. Defaults to {@link createMemoryGuapStore}, which is process-local and non-durable. */
	store?: GuapStore;
	/** Serve a local record only if it was written within this many ms; unset means no expiry. */
	maxAgeMs?: number;
	/** Webhook registration/ingest configuration. */
	webhook?: {
		/** Publicly reachable URL for this handler; required for auto-registration behind a proxy/load balancer. */
		publicUrl?: string;
		/** Domain events to subscribe to. Defaults to `"*"` (all). */
		events?: "*" | string[];
		description?: string;
		/** Idempotency key for registration. Defaults to `"sdk-local:" + pathname of publicUrl` (or `"sdk-local:/guap"`). */
		registrationKey?: string;
		/** Auto-register (and re-register on a rotated secret) instead of requiring an explicit `register()` call. Defaults to `true`. */
		autoRegister?: boolean;
	};
	/** Webhook hooks to run after every verified, projected delivery. Overridable per-call via `handler(hooks)`. */
	hooks?: GuapWebhookHooks;
	onError?: (
		error: unknown,
		context: { scope: "store" | "webhook" | "registration" | "hook"; detail?: string },
	) => void;
};

/**
 * The store-backed local read model returned by {@link createGuapLocal}: a
 * {@link GuapAdapter} to plug into `createGuapocadoClient({ adapter })`, a
 * webhook `handler` factory, a `project` test seam, and an explicit
 * `register` you can call outside of a request (e.g. at boot).
 */
export type GuapLocal = {
	/** Plug into `createGuapocadoClient({ adapter })` (or use {@link createGuapocadoClientWithLocal}) for local-first reads. */
	adapter: GuapAdapter;
	/** Builds a fetch-shaped webhook receiver; call with hooks to run on each delivered event, or with no arguments for projection-only behavior. */
	handler: (hooks?: GuapWebhookHooks) => (request: Request) => Promise<Response>;
	/** Applies one domain event envelope directly — a seam for tests and non-HTTP transports (e.g. a queue consumer). */
	project: (event: GuapDomainEventEnvelope) => Promise<void>;
	/** Explicitly registers the webhook endpoint (normally done lazily on first GET/POST). */
	register: () => Promise<{ id: string; status: string; url: string }>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SubscriptionSnapshot = GuapSubscriptionUpdatedData["subscription"];

type RegistrationMeta = {
	id: string;
	url: string;
	events: "*" | string[];
	status: "active" | "pending_approval";
	signingSecret: string;
};

function keyOf(...parts: string[]): string {
	return parts.map((part) => encodeURIComponent(part)).join(":");
}

function prefixOf(customerId: string): string {
	return `${encodeURIComponent(customerId)}:`;
}

function isStale(record: GuapStoreRecord, maxAgeMs: number | undefined): boolean {
	if (maxAgeMs === undefined) return false;
	return Date.now() - record.writtenAt > maxAgeMs;
}

async function readValue<T>(
	store: GuapStore,
	collection: string,
	id: string,
	maxAgeMs: number | undefined,
): Promise<GuapAdapterResult<T>> {
	const record = await store.get(collection, id);
	if (!record) return { found: false };
	if (isStale(record, maxAgeMs)) return { found: false, reason: "stale" };
	return { found: true, value: record.value as T };
}

async function lwwPut(
	store: GuapStore,
	collection: string,
	id: string,
	value: unknown,
	sourceTs: number,
): Promise<void> {
	const existing = await store.get(collection, id);
	if (existing && existing.sourceTs > sourceTs) return; // strictly-older writes are rejected; ties favor the newer arrival
	await store.put(collection, id, { value, sourceTs, writtenAt: Date.now() });
}

async function invalidatePrefixes(
	store: GuapStore,
	customerId: string,
	collections: string[],
): Promise<void> {
	const prefix = prefixOf(customerId);
	for (const collection of collections) {
		const rows = await store.listByPrefix(collection, prefix);
		for (const row of rows) await store.delete(collection, row.id);
	}
}

async function rewritePurchasesPrefix(
	store: GuapStore,
	customerId: string,
	purchases: Purchase[],
	sourceTs: number,
): Promise<void> {
	const prefix = prefixOf(customerId);
	const existing = await store.listByPrefix("purchases", prefix);
	for (const row of existing) await store.delete("purchases", row.id);
	for (const purchase of purchases) {
		await store.put("purchases", keyOf(customerId, purchase.id), {
			value: purchase,
			sourceTs,
			writtenAt: Date.now(),
		});
	}
}

function parseCustomerSnapshot(
	customer: GuapCustomerUpdatedData["customer"],
): Record<string, unknown> {
	const { metadata, ...rest } = customer;
	let parsedMetadata: unknown = metadata;
	if (typeof metadata === "string") {
		try {
			parsedMetadata = JSON.parse(metadata);
		} catch {
			parsedMetadata = metadata; // leave the raw string — lenient parsing, never throw
		}
	}
	return { ...rest, metadata: parsedMetadata };
}

function sourceTsOf(envelope: GuapDomainEventEnvelope): number {
	const parsed = Date.parse(envelope.createdAt);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Outcome of applying one envelope, carrying whatever the projector already read so hook dispatch needs no extra store reads. */
type ProjectionOutcome = {
	previousSubscription?: SubscriptionSnapshot | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Applies one envelope to the store. Defensive against malformed/garbage
 * `data` on an otherwise-recognized event type — a fuzzed or hand-rolled
 * envelope that claims `"customer.updated"` without a well-formed `customer`
 * payload is treated as a no-op rather than throwing, matching the "never
 * crash on arbitrary input" contract exercised by the fuzz test suite.
 */
async function applyProjection(
	store: GuapStore,
	envelope: GuapDomainEventEnvelope,
): Promise<ProjectionOutcome> {
	const sourceTs = sourceTsOf(envelope);
	const data = asRecord(envelope.data);

	switch (envelope.type) {
		case "customer.updated": {
			const customer = asRecord(data?.customer);
			const id = nonEmptyString(customer?.id);
			if (!customer || !id) return {};
			await lwwPut(
				store,
				"customers",
				id,
				parseCustomerSnapshot(customer as GuapCustomerUpdatedData["customer"]),
				sourceTs,
			);
			return {};
		}
		case "subscription.updated": {
			const subscription = asRecord(data?.subscription);
			const customerId = nonEmptyString(subscription?.customerId);
			if (!subscription || !customerId) return {};
			const previousRecord = await store.get("subscriptions", customerId);
			const previous = (previousRecord?.value as SubscriptionSnapshot | null | undefined) ?? null;
			await lwwPut(store, "subscriptions", customerId, subscription, sourceTs);
			if (previous && previous.status !== subscription.status) {
				await invalidatePrefixes(store, customerId, ["features", "limits"]);
			}
			return { previousSubscription: previous };
		}
		case "purchase.completed":
		case "purchase.updated": {
			const purchase = asRecord(data?.purchase);
			const customerId = nonEmptyString(purchase?.customerId);
			const purchaseId = nonEmptyString(purchase?.id);
			if (!purchase || !customerId || !purchaseId) return {};
			await lwwPut(store, "purchases", keyOf(customerId, purchaseId), purchase, sourceTs);
			return {};
		}
		case "entitlements.updated": {
			const customerId = nonEmptyString(data?.customerId);
			if (!customerId) return {};
			await invalidatePrefixes(store, customerId, ["features", "limits", "usage"]);
			return {};
		}
		case "invoice.updated": {
			const invoice = asRecord(data?.invoice);
			const customerId = nonEmptyString(invoice?.customerId);
			const invoiceId = nonEmptyString(invoice?.id);
			if (!invoice || !customerId || !invoiceId) return {};
			await lwwPut(store, "invoices", keyOf(customerId, invoiceId), invoice, sourceTs);
			return {};
		}
		case "usage.updated": {
			// Declared in the domain event catalog but never emitted today; project it once the
			// platform ships snapshots, using the same customerId:key keying as true-up.
			const customerId = nonEmptyString(data?.customerId);
			const key = nonEmptyString(data?.key);
			const balance = data?.balance as UsageBalance | undefined;
			if (customerId && key && balance) {
				await lwwPut(store, "usage", keyOf(customerId, key), balance, sourceTs);
			}
			return {};
		}
		default:
			return {}; // unknown/forward-compatible event type: no-op, still deduped by the caller
	}
}

function extractCustomerId(envelope: GuapDomainEventEnvelope): string | null {
	const data = envelope.data as Record<string, unknown> | null | undefined;
	if (!data || typeof data !== "object") return null;

	const nested = (key: string, field: string): string | null => {
		const value = data[key];
		if (!value || typeof value !== "object") return null;
		const id = (value as Record<string, unknown>)[field];
		return typeof id === "string" && id.length > 0 ? id : null;
	};

	switch (envelope.type) {
		case "customer.updated":
			return nested("customer", "id");
		case "subscription.updated":
			return nested("subscription", "customerId");
		case "purchase.completed":
		case "purchase.updated":
			return nested("purchase", "customerId");
		case "invoice.updated":
			return nested("invoice", "customerId");
		default: {
			const id = data.customerId;
			return typeof id === "string" && id.length > 0 ? id : null;
		}
	}
}

const ACTIVE_SUBSCRIPTION_STATUS: SubscriptionStatus = "active";

/** Builds a typed hook context: casts the envelope's `data: unknown` to `TData` in one place. */
function makeHookContext<TData>(
	envelope: GuapDomainEventEnvelope,
	customerId: string | null,
	client: GuapocadoClient,
	data: TData,
): GuapHookContext<TData> {
	return {
		event: envelope as GuapDomainEventEnvelope & { data: TData },
		customerId,
		data,
		client,
	};
}

async function dispatchHooks(
	hooks: GuapWebhookHooks,
	envelope: GuapDomainEventEnvelope,
	outcome: ProjectionOutcome,
	client: GuapocadoClient,
): Promise<void> {
	const customerId = extractCustomerId(envelope);

	switch (envelope.type) {
		case "customer.updated":
			if (hooks.onCustomerUpdated) {
				const data = envelope.data as GuapCustomerUpdatedData;
				await hooks.onCustomerUpdated(makeHookContext(envelope, customerId, client, data));
			}
			break;
		case "subscription.updated":
			if (hooks.onSubscriptionUpdated) {
				const data = envelope.data as GuapSubscriptionUpdatedData;
				await hooks.onSubscriptionUpdated(makeHookContext(envelope, customerId, client, data));
			}
			break;
		case "purchase.completed":
			if (hooks.onPurchaseCompleted) {
				const data = envelope.data as GuapPurchaseCompletedData;
				await hooks.onPurchaseCompleted(makeHookContext(envelope, customerId, client, data));
			}
			break;
		case "purchase.updated":
			if (hooks.onPurchaseUpdated) {
				const data = envelope.data as GuapPurchaseUpdatedData;
				await hooks.onPurchaseUpdated(makeHookContext(envelope, customerId, client, data));
			}
			break;
		case "entitlements.updated":
			if (hooks.onEntitlementsUpdated) {
				const data = envelope.data as GuapEntitlementsUpdatedData;
				await hooks.onEntitlementsUpdated(makeHookContext(envelope, customerId, client, data));
			}
			break;
		case "invoice.updated":
			if (hooks.onInvoiceUpdated) {
				const data = envelope.data as GuapInvoiceUpdatedData;
				await hooks.onInvoiceUpdated(makeHookContext(envelope, customerId, client, data));
			}
			break;
		default:
			break;
	}

	if (envelope.type === "subscription.updated") {
		const data = envelope.data as GuapSubscriptionUpdatedData;
		const subscription = data.subscription;
		const previous = outcome.previousSubscription ?? null;
		const wasActive = previous?.status === ACTIVE_SUBSCRIPTION_STATUS;
		const isActive = subscription.status === ACTIVE_SUBSCRIPTION_STATUS;

		if (!wasActive && isActive && hooks.onSubscribe) {
			await hooks.onSubscribe({
				...makeHookContext(envelope, customerId, client, data),
				subscription,
				previous,
			});
		}
		if (subscription.status === "canceled" && previous?.status !== "canceled" && hooks.onCancel) {
			await hooks.onCancel({
				...makeHookContext(envelope, customerId, client, data),
				subscription,
				previous,
			});
		}
		if (previous && previous.planKey !== subscription.planKey && hooks.onPlanChange) {
			await hooks.onPlanChange({
				...makeHookContext(envelope, customerId, client, data),
				subscription,
				previous,
			});
		}
	}

	if (envelope.type === "purchase.completed" && hooks.onPurchase) {
		const data = envelope.data as GuapPurchaseCompletedData;
		await hooks.onPurchase({
			...makeHookContext(envelope, customerId, client, data),
			purchase: data.purchase,
			grants: data.grants,
		});
	}

	if (hooks.onEvent) {
		await hooks.onEvent(makeHookContext(envelope, customerId, client, envelope.data));
	}
}

function parseSignatureHeader(signature: string): { timestamp: number; v1: string } | null {
	const parts = Object.fromEntries(
		signature.split(",").map((part) => {
			const [key, value] = part.split("=");
			return [key, value];
		}),
	);
	const timestamp = Number(parts.t);
	const v1 = parts.v1;
	if (!Number.isFinite(timestamp) || !v1) return null;
	return { timestamp, v1 };
}

function hexToBytes(hex: string): ArrayBuffer {
	if (hex.length % 2 !== 0) return new ArrayBuffer(0);
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes.buffer;
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/**
 * Verifies a Guapocado webhook signature (`guapocado-signature: t=...,v1=...`)
 * against the exact raw request body, using Web Crypto only (no new runtime
 * dependency, works on Workers and Node 18+). This is the same check
 * `@guapocado/better-auth` performs internally, extracted so any receiver —
 * `@guapocado/sdk`'s own `createGuapLocal`, a custom transport, or a future
 * `better-auth` delegation — can reuse it.
 *
 * @param input - The raw request body (`payload`), the endpoint's
 *   `signingSecret`, the raw `guapocado-signature` header value, and an
 *   optional `toleranceSeconds` (default 300) for clock-skew tolerance.
 * @returns `true` if the signature is valid and within tolerance, `false`
 *   otherwise (never throws on malformed input).
 * @example
 * ```typescript
 * import { verifyGuapocadoSignature } from "@guapocado/sdk";
 *
 * const secret = "whsec_example";
 * const payload = JSON.stringify({ id: "evt_1", type: "customer.updated" });
 *
 * // Build a signature the same way the platform does, to see verification pass.
 * const timestamp = Math.floor(Date.now() / 1000);
 * const key = await crypto.subtle.importKey(
 *   "raw",
 *   new TextEncoder().encode(secret),
 *   { name: "HMAC", hash: "SHA-256" },
 *   false,
 *   ["sign"],
 * );
 * const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
 * const hex = Array.from(new Uint8Array(mac))
 *   .map((byte) => byte.toString(16).padStart(2, "0"))
 *   .join("");
 *
 * const valid = await verifyGuapocadoSignature({
 *   payload,
 *   secret,
 *   signature: `t=${timestamp},v1=${hex}`,
 * });
 * console.log(valid); // true
 * ```
 */
export async function verifyGuapocadoSignature(input: {
	payload: string;
	secret: string;
	signature: string | null | undefined;
	toleranceSeconds?: number;
}): Promise<boolean> {
	const { payload, secret, signature, toleranceSeconds = 300 } = input;
	if (!signature || !secret) return false;
	const parsed = parseSignatureHeader(signature);
	if (!parsed) return false;
	if (Math.abs(Date.now() / 1000 - parsed.timestamp) > toleranceSeconds) return false;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		"HMAC",
		key,
		hexToBytes(parsed.v1),
		new TextEncoder().encode(`${parsed.timestamp}.${payload}`),
	);
}

/**
 * Creates a process-local, non-durable {@link GuapStore} backed by an
 * in-memory `Map`. Useful for tests, local development, and single-instance
 * deployments where losing the projection on restart (and re-seeding it from
 * miss-through API calls) is acceptable. For anything durable, implement
 * {@link GuapStore} over SQLite/D1/Postgres/Redis/etc — see the sdk README
 * for SQL sketches, and {@link testGuapStoreContract} (in `@guapocado/sdk/testing`)
 * to validate a custom implementation.
 *
 * @returns A {@link GuapStore} whose data lives only in process memory.
 * @example
 * ```typescript
 * import { createGuapLocal, createMemoryGuapStore } from "@guapocado/sdk";
 *
 * const local = createGuapLocal({
 *   apiKey: process.env.GUAPOCADO_API_KEY!,
 *   store: createMemoryGuapStore(), // the default; shown explicitly here
 * });
 * ```
 */
export function createMemoryGuapStore(): GuapStore {
	const collections = new Map<string, Map<string, GuapStoreRecord>>();

	function bucket(collection: string): Map<string, GuapStoreRecord> {
		let existing = collections.get(collection);
		if (!existing) {
			existing = new Map();
			collections.set(collection, existing);
		}
		return existing;
	}

	return {
		async get(collection, id) {
			const record = bucket(collection).get(id);
			return record ? { ...record } : null;
		},
		async put(collection, id, record) {
			bucket(collection).set(id, { ...record });
		},
		async delete(collection, id) {
			bucket(collection).delete(id);
		},
		async listByPrefix(collection, idPrefix) {
			const rows: Array<{ id: string; record: GuapStoreRecord }> = [];
			for (const [id, record] of bucket(collection)) {
				if (id.startsWith(idPrefix)) rows.push({ id, record: { ...record } });
			}
			return rows;
		},
	};
}

const REREGISTER_COOLDOWN_MS = 5 * 60_000;

/**
 * Creates the store-backed local read model: a {@link GuapAdapter} for
 * local-first reads, a webhook `handler` factory that verifies, dedupes, and
 * projects Guapocado domain events (and runs your {@link GuapWebhookHooks}),
 * a `project` seam for tests/custom transports, and an explicit `register`.
 * Auto-registers the webhook endpoint lazily (on first GET, first POST, or an
 * explicit `register()` call) unless `webhook.autoRegister` is `false`. New
 * endpoints start `pending_approval` in the Guapocado dashboard — reads keep
 * working correctly via miss-through to the API in the meantime.
 *
 * @param options - `apiKey` is required; `store` defaults to an in-memory
 *   map, `maxAgeMs` to no expiry, and `webhook.events` to `"*"`. See
 *   {@link GuapLocalOptions} for the full list.
 * @returns A {@link GuapLocal} bundling the adapter, webhook handler,
 *   projection seam, and explicit registration.
 * @example
 * ```typescript
 * import { createGuapLocal, createGuapocadoClient, type GuapCancelHookContext } from "@guapocado/sdk";
 *
 * const local = createGuapLocal({
 *   apiKey: process.env.GUAPOCADO_API_KEY!,
 *   webhook: { publicUrl: "https://app.example.com/webhooks/guap" },
 * });
 *
 * const guap = createGuapocadoClient({
 *   apiKey: process.env.GUAPOCADO_API_KEY!,
 *   adapter: local.adapter,
 * });
 *
 * // Mount as a fetch handler (Workers, Bun, Deno, Node's http.toWebHandler, ...).
 * // Both a pre-packaged function reference and an inline lambda work — both
 * // are fully typed with zero annotations:
 * async function sendCancellationEmail(ctx: GuapCancelHookContext) {
 *   await fetch("https://api.example.com/notify", {
 *     method: "POST",
 *     body: JSON.stringify({ customerId: ctx.customerId, reason: "canceled" }),
 *   });
 * }
 *
 * const webhookHandler = local.handler({
 *   onCancel: sendCancellationEmail,
 *   onPurchase: async (ctx) => {
 *     console.log(`${ctx.customerId} purchased ${ctx.purchase.productKey}`, ctx.grants);
 *   },
 * });
 *
 * export default { fetch: (request: Request) => webhookHandler(request) };
 * ```
 */
export function createGuapLocal(options: GuapLocalOptions): GuapLocal {
	const store = options.store ?? createMemoryGuapStore();
	const maxAgeMs = options.maxAgeMs;
	const constructorHooks = options.hooks ?? {};
	const autoRegisterEnabled = options.webhook?.autoRegister ?? true;
	const apiClient = createGuapocadoClient({ apiKey: options.apiKey, apiUrl: options.apiUrl });

	let lastReRegisterAt = 0;
	function canReRegister(): boolean {
		return Date.now() - lastReRegisterAt > REREGISTER_COOLDOWN_MS;
	}

	function onErr(
		error: unknown,
		scope: "store" | "webhook" | "registration" | "hook",
		detail?: string,
	): void {
		options.onError?.(error, { scope, detail });
	}

	function defaultRegistrationKey(url: string): string {
		try {
			const pathname = new URL(url).pathname || "/guap";
			return `sdk-local:${pathname}`;
		} catch {
			return "sdk-local:/guap";
		}
	}

	async function getRegistrationMeta(): Promise<RegistrationMeta | null> {
		const record = await store.get("meta", "registration");
		return (record?.value as RegistrationMeta | undefined) ?? null;
	}

	async function performRegister(url: string): Promise<RegistrationMeta> {
		const events = options.webhook?.events ?? "*";
		const registration = await apiClient.webhooks.register({
			url,
			events,
			description: options.webhook?.description ?? "Guapocado local read model",
			integration: "sdk-local",
			registrationKey: options.webhook?.registrationKey ?? defaultRegistrationKey(url),
		});
		const meta: RegistrationMeta = {
			id: registration.id,
			url: registration.url,
			events: registration.events,
			status: registration.status,
			signingSecret: registration.signingSecret,
		};
		const now = Date.now();
		await store.put("meta", "registration", { value: meta, sourceTs: now, writtenAt: now });
		return meta;
	}

	function resolvePublicUrl(request: Request): string {
		return (
			options.webhook?.publicUrl ?? request.headers.get("x-guapocado-public-url") ?? request.url
		);
	}

	async function register(): Promise<{ id: string; status: string; url: string }> {
		const publicUrl = options.webhook?.publicUrl;
		if (!publicUrl) {
			throw new GuapocadoValidationError(
				"createGuapLocal: webhook.publicUrl is required to call register() explicitly",
			);
		}
		const meta = await performRegister(publicUrl);
		return { id: meta.id, status: meta.status, url: meta.url };
	}

	async function project(envelope: GuapDomainEventEnvelope): Promise<void> {
		await applyProjection(store, envelope);
	}

	async function handlePost(effectiveHooks: GuapWebhookHooks, request: Request): Promise<Response> {
		let meta = await getRegistrationMeta();
		if (!meta?.signingSecret && autoRegisterEnabled) {
			meta = await performRegister(resolvePublicUrl(request)).catch((error) => {
				onErr(error, "registration", "lazy register on POST");
				return meta ?? null;
			});
		}

		const rawBody = await request.text();
		const signatureHeader = request.headers.get("guapocado-signature");

		let verified = meta?.signingSecret
			? await verifyGuapocadoSignature({
					payload: rawBody,
					secret: meta.signingSecret,
					signature: signatureHeader,
				})
			: false;

		if (!verified && autoRegisterEnabled && canReRegister()) {
			lastReRegisterAt = Date.now();
			const reregistered = await performRegister(meta?.url ?? resolvePublicUrl(request)).catch(
				(error) => {
					onErr(error, "registration", "re-register after verify failure");
					return null;
				},
			);
			if (reregistered) {
				meta = reregistered;
				verified = await verifyGuapocadoSignature({
					payload: rawBody,
					secret: reregistered.signingSecret,
					signature: signatureHeader,
				});
			}
		}

		if (!verified) return jsonResponse({ error: "invalid or missing signature" }, 401);

		let envelope: GuapDomainEventEnvelope;
		try {
			const parsed = JSON.parse(rawBody);
			if (
				!parsed ||
				typeof parsed !== "object" ||
				typeof parsed.id !== "string" ||
				typeof parsed.type !== "string"
			) {
				return jsonResponse({ error: "malformed webhook payload" }, 400);
			}
			envelope = parsed as GuapDomainEventEnvelope;
		} catch {
			return jsonResponse({ error: "malformed JSON body" }, 400);
		}

		const seen = await store.get("events", envelope.id);
		if (seen) return jsonResponse({ received: true, deduplicated: true }, 200);

		let outcome: ProjectionOutcome;
		try {
			outcome = await applyProjection(store, envelope);
		} catch (error) {
			onErr(error, "store", `project:${envelope.type}`);
			return jsonResponse({ error: "projection failed" }, 500);
		}

		try {
			await dispatchHooks(effectiveHooks, envelope, outcome, apiClient);
		} catch (error) {
			onErr(error, "hook", `hook:${envelope.type}`);
			return jsonResponse({ error: "webhook hook failed" }, 500);
		}

		const now = Date.now();
		await store
			.put("events", envelope.id, { value: { type: envelope.type }, sourceTs: now, writtenAt: now })
			.catch((error) => onErr(error, "store", "dedup marker write"));

		const known = (GUAPOCADO_DOMAIN_EVENTS as readonly string[]).includes(envelope.type);
		return jsonResponse(known ? { received: true } : { received: true, ignored: true }, 200);
	}

	async function handleGet(request: Request): Promise<Response> {
		let meta = await getRegistrationMeta();
		if (!meta && autoRegisterEnabled) {
			meta = await performRegister(resolvePublicUrl(request)).catch((error) => {
				onErr(error, "registration", "bootstrap register on GET");
				return null;
			});
		}
		return jsonResponse(
			{
				ok: true,
				registered: Boolean(meta),
				...(meta ? { endpointId: meta.id, status: meta.status, url: meta.url } : {}),
			},
			200,
		);
	}

	function handler(hooks?: GuapWebhookHooks): (request: Request) => Promise<Response> {
		const effectiveHooks: GuapWebhookHooks = { ...constructorHooks, ...hooks };
		return async (request: Request): Promise<Response> => {
			if (request.method === "GET") return handleGet(request);
			if (request.method === "POST") return handlePost(effectiveHooks, request);
			return new Response(null, { status: 405 });
		};
	}

	const adapter: GuapAdapter = {
		has: ({ customerId, key }) =>
			readValue<boolean>(store, "features", keyOf(customerId, key), maxAgeMs),
		limit: ({ customerId, key }) =>
			readValue<LimitBalance>(store, "limits", keyOf(customerId, key), maxAgeMs),
		usageBalance: ({ customerId, key }) =>
			readValue<UsageBalance>(store, "usage", keyOf(customerId, key), maxAgeMs),
		currentSubscription: ({ customerId }) =>
			readValue<Subscription | null>(store, "subscriptions", customerId, maxAgeMs),
		plans: () => readValue<Product[]>(store, "plans", "all", maxAgeMs),
		purchases: async ({ customerId }) => {
			const rows = await store.listByPrefix("purchases", prefixOf(customerId));
			if (rows.length === 0) return { found: false };
			const stale = maxAgeMs !== undefined && rows.some((row) => isStale(row.record, maxAgeMs));
			if (stale) return { found: false, reason: "stale" };
			return { found: true, value: rows.map((row) => row.record.value as Purchase) };
		},
		context: async () => ({ found: false }),
		trueUp: async (event: GuapAdapterTrueUpEvent) => {
			const now = Date.now();
			switch (event.operation) {
				case "has":
					await store.put("features", keyOf(event.customerId, event.key), {
						value: event.value,
						sourceTs: now,
						writtenAt: now,
					});
					break;
				case "limit":
					await store.put("limits", keyOf(event.customerId, event.key), {
						value: event.value,
						sourceTs: now,
						writtenAt: now,
					});
					break;
				case "usage.balance":
					await store.put("usage", keyOf(event.customerId, event.key), {
						value: event.value,
						sourceTs: now,
						writtenAt: now,
					});
					break;
				case "subscription.current":
					await store.put("subscriptions", event.customerId, {
						value: event.value,
						sourceTs: now,
						writtenAt: now,
					});
					break;
				case "plans.list":
					await store.put("plans", "all", { value: event.value, sourceTs: now, writtenAt: now });
					break;
				case "purchases.list":
					await rewritePurchasesPrefix(store, event.customerId, event.value, now);
					break;
				case "context": {
					const { input, value } = event;
					const customerId = input.customerId;
					if (value.customer) {
						await store.put("customers", customerId, {
							value: value.customer,
							sourceTs: now,
							writtenAt: now,
						});
					}
					for (const [key, featureValue] of Object.entries(value.features)) {
						await store.put("features", keyOf(customerId, key), {
							value: featureValue,
							sourceTs: now,
							writtenAt: now,
						});
					}
					for (const [key, usageValue] of Object.entries(value.usage)) {
						await store.put("usage", keyOf(customerId, key), {
							value: usageValue,
							sourceTs: now,
							writtenAt: now,
						});
					}
					for (const [key, limitValue] of Object.entries(value.limits)) {
						await store.put("limits", keyOf(customerId, key), {
							value: limitValue,
							sourceTs: now,
							writtenAt: now,
						});
					}
					await store.put("plans", "all", { value: value.plans, sourceTs: now, writtenAt: now });
					await store.put("subscriptions", customerId, {
						value: value.subscription,
						sourceTs: now,
						writtenAt: now,
					});
					break;
				}
			}
		},
		onError: (error, context) => {
			onErr(error, "store", `${context.operation}/${context.phase}`);
		},
	};

	return { adapter, handler, project, register };
}

/**
 * Convenience one-liner combining {@link createGuapLocal} and
 * `createGuapocadoClient`: builds the store-backed local read model, wires it
 * in as the client's adapter, and attaches the webhook `handler` factory
 * directly to the returned client so you never have to juggle two objects.
 *
 * @param options - Every `createGuapocadoClient` option (`apiKey`,
 *   `customerId`, `apiUrl`) plus every {@link GuapLocalOptions} option except
 *   `apiKey`/`apiUrl` (which are shared), including `store`, `maxAgeMs`,
 *   `webhook`, and `hooks`.
 * @returns A `GuapocadoClient` with an extra `handler` property: call it with
 *   {@link GuapWebhookHooks} (or no arguments) to get a fetch-shaped webhook
 *   receiver.
 * @example
 * ```typescript
 * import { createGuapocadoClientWithLocal, type GuapPurchaseHookContext } from "@guapocado/sdk";
 *
 * const guap = createGuapocadoClientWithLocal({
 *   apiKey: process.env.GUAPOCADO_API_KEY!,
 *   webhook: { publicUrl: "https://app.example.com/webhooks/guap" },
 * });
 *
 * // The dream one-liner: mount the handler with hooks, no DB polling required.
 * // Prepackaged function references and inline lambdas both fully type-check.
 * async function sendWelcomeEmail(ctx: GuapPurchaseHookContext) {
 *   console.log(`${ctx.customerId} purchased ${ctx.purchase.productKey}`, ctx.grants);
 * }
 *
 * const webhookHandler = guap.handler({
 *   onPurchase: sendWelcomeEmail,
 *   onCancel: async (ctx) => {
 *     console.log(`${ctx.customerId} canceled (was ${ctx.previous?.planKey ?? "unknown"})`);
 *   },
 * });
 *
 * export default {
 *   fetch: (request: Request) =>
 *     request.url.endsWith("/webhooks/guap") ? webhookHandler(request) : guap.has("feature"),
 * };
 * ```
 */
export function createGuapocadoClientWithLocal(
	options: GuapocadoClientOptions & Omit<GuapLocalOptions, "apiKey" | "apiUrl">,
): GuapocadoClient & {
	handler: (hooks?: GuapWebhookHooks) => (request: Request) => Promise<Response>;
} {
	const { store, maxAgeMs, webhook, hooks, onError, ...clientOptions } = options;
	const local = createGuapLocal({
		apiKey: clientOptions.apiKey,
		apiUrl: clientOptions.apiUrl,
		store,
		maxAgeMs,
		webhook,
		hooks,
		onError,
	});
	const client = createGuapocadoClient({ ...clientOptions, adapter: local.adapter });
	return Object.assign(client, { handler: local.handler });
}
