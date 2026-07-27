import packageJson from "../package.json";

/** API contract used by this CLI release. */
export const GUAPOCADO_CLI_API_VERSION = packageJson.version;

/** Standard version and authentication headers for CLI calls to `/v1`. */
export function guapocadoApiHeaders(
	apiKey: string,
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		"x-guapocado-key": apiKey,
		"Guapocado-Version": GUAPOCADO_CLI_API_VERSION,
		"Guapocado-SDK-Version": packageJson.version,
		"Guapocado-SDK-Language": "cli",
		...extra,
	};
}
