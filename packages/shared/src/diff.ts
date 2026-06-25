import type { BillingConfig } from "./schema.js";

/** Single config difference between a local config and a remote config. */
export type DiffEntry = {
	type: "added" | "removed" | "changed";
	path: string;
	oldValue?: unknown;
	newValue?: unknown;
};

function flattenObject(obj: unknown, prefix: string): [string, unknown][] {
	if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj)) {
		return [[prefix, obj]];
	}
	const result: [string, unknown][] = [];
	for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
		result.push(...flattenObject(val, `${prefix}.${key}`));
	}
	return result;
}

function diffObjects(basePath: string, oldObj: unknown, newObj: unknown): DiffEntry[] {
	const oldFlat = new Map(flattenObject(oldObj, basePath));
	const newFlat = new Map(flattenObject(newObj, basePath));

	const diffs: DiffEntry[] = [];

	for (const [path, newVal] of newFlat) {
		if (!oldFlat.has(path)) {
			diffs.push({ type: "added", path, newValue: newVal });
		} else if (JSON.stringify(oldFlat.get(path)) !== JSON.stringify(newVal)) {
			diffs.push({ type: "changed", path, oldValue: oldFlat.get(path), newValue: newVal });
		}
	}

	for (const [path, oldVal] of oldFlat) {
		if (!newFlat.has(path)) {
			diffs.push({ type: "removed", path, oldValue: oldVal });
		}
	}

	return diffs.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compares a local billing config against a remote one and returns a sorted
 * list of field-level differences, descending into changed entitlements and
 * products to report the exact dotted paths that were added, removed, or
 * changed — used by the CLI to preview what `guap push` would apply.
 *
 * @param local The local (desired) billing config, typically loaded from `billing.config.ts`.
 * @param remote The remote (currently deployed) billing config to compare against.
 * @returns An array of {@link DiffEntry} objects describing each added, removed, or changed field; empty when the configs are equivalent.
 * @example
 * ```ts
 * import { diffConfigs } from "@guapocado/shared";
 *
 * const diff = diffConfigs(localConfig, remoteConfig);
 * for (const entry of diff) {
 * 	console.log(`${entry.type}: ${entry.path}`);
 * }
 * ```
 */
export function diffConfigs(local: BillingConfig, remote: BillingConfig): DiffEntry[] {
	const diffs: DiffEntry[] = [];

	for (const key of Object.keys(local.entitlements)) {
		if (!(key in remote.entitlements)) {
			diffs.push({ type: "added", path: `entitlements.${key}`, newValue: local.entitlements[key] });
		} else if (
			JSON.stringify(local.entitlements[key]) !== JSON.stringify(remote.entitlements[key])
		) {
			diffs.push(
				...diffObjects(`entitlements.${key}`, remote.entitlements[key], local.entitlements[key]),
			);
		}
	}
	for (const key of Object.keys(remote.entitlements)) {
		if (!(key in local.entitlements)) {
			diffs.push({
				type: "removed",
				path: `entitlements.${key}`,
				oldValue: remote.entitlements[key],
			});
		}
	}

	const localProducts = new Map(local.products.map((p) => [p.key, p]));
	const remoteProducts = new Map(remote.products.map((p) => [p.key, p]));

	for (const [key, product] of localProducts) {
		if (!remoteProducts.has(key)) {
			diffs.push({ type: "added", path: `products.${key}`, newValue: product });
		} else if (JSON.stringify(product) !== JSON.stringify(remoteProducts.get(key))) {
			diffs.push(...diffObjects(`products.${key}`, remoteProducts.get(key), product));
		}
	}
	for (const key of remoteProducts.keys()) {
		if (!localProducts.has(key)) {
			diffs.push({ type: "removed", path: `products.${key}`, oldValue: remoteProducts.get(key) });
		}
	}

	return diffs;
}
