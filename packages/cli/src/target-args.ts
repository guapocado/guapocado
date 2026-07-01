import consola from "consola";
import type { TargetMode } from "./config.js";

/**
 * Target-environment flags shared by `push`/`plan`/`diff`. The CLI surface
 * speaks **test/live** — matching the platform's `mode` enum and the
 * `sk_guap_test_`/`sk_guap_live_` key prefixes. `--sandbox`/`--production` are
 * kept as deprecated aliases so existing scripts keep working.
 *
 * The resolved {@link TargetMode} strings (`"sandbox"`/`"production"`) are
 * internal storage identifiers and intentionally unchanged.
 */
export const targetArgs = {
	test: {
		type: "boolean",
		description: "Target the test environment (uses a sk_guap_test_ key)",
	},
	live: {
		type: "boolean",
		description: "Target the live environment (uses a sk_guap_live_ key)",
	},
	sandbox: {
		type: "boolean",
		description: "Deprecated alias for --test",
	},
	production: {
		type: "boolean",
		description: "Deprecated alias for --live",
	},
} as const;

type TargetArgValues = {
	test?: boolean;
	live?: boolean;
	sandbox?: boolean;
	production?: boolean;
};

/**
 * Resolve the target environment from the test/live flags, honoring the
 * deprecated sandbox/production aliases (with a deprecation warning). Returns
 * `null` when no target flag was supplied, so callers can fall back to the
 * legacy `--env` behaviour.
 */
export function resolveTargetMode(args: TargetArgValues): TargetMode | null {
	if (args.sandbox) consola.warn("`--sandbox` is deprecated; use `--test`.");
	if (args.production) consola.warn("`--production` is deprecated; use `--live`.");

	const wantsTest = Boolean(args.test || args.sandbox);
	const wantsLive = Boolean(args.live || args.production);
	if (wantsTest && wantsLive) {
		throw new Error("Choose either --test or --live, not both.");
	}
	if (wantsTest) return "sandbox";
	if (wantsLive) return "production";
	return null;
}
