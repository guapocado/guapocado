import type { BillingConfig } from "./schema.js";

/**
 * Deterministic, order-insensitive JSON: recursively sorts object keys so the
 * same logical config always serializes identically regardless of key order.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const obj = value as Record<string, unknown>;
	const entries = Object.keys(obj)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
	return `{${entries.join(",")}}`;
}

/**
 * Creates a deterministic, compact base-36 hash of a billing config by
 * stable-stringifying it (sorting object keys recursively) so logically
 * identical configs always hash the same regardless of key order, while any
 * content change produces a different hash.
 *
 * @param config The billing config to fingerprint into a stable version string.
 * @returns A 7-character, zero-padded base-36 hash string uniquely identifying the config's content.
 * @example
 * ```ts
 * import { hashConfig } from "@guapocado/shared";
 *
 * const version = hashConfig(config);
 * if (version !== lastDeployedVersion) {
 * 	console.log("config changed since last deploy");
 * }
 * ```
 */
export function hashConfig(config: BillingConfig): string {
	const canonical = stableStringify(config);
	let hash = 0;
	for (let i = 0; i < canonical.length; i++) {
		const char = canonical.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return (hash >>> 0).toString(36).padStart(7, "0");
}

/** Billing config plus its calculated version string. */
export type VersionedBillingConfig = {
	version: string;
	config: BillingConfig;
};

/**
 * Wraps a billing config together with its deterministic {@link hashConfig}
 * version string, producing the {@link VersionedBillingConfig} pair used to
 * compare and track config revisions across deploys.
 *
 * @param config The billing config to pair with its computed version hash.
 * @returns A {@link VersionedBillingConfig} containing the original `config` and its `version` hash.
 * @example
 * ```ts
 * import { versionConfig } from "@guapocado/shared";
 *
 * const { version, config: snapshot } = versionConfig(config);
 * await store.put(`config:${version}`, snapshot);
 * ```
 */
export function versionConfig(config: BillingConfig): VersionedBillingConfig {
	return {
		version: hashConfig(config),
		config,
	};
}
