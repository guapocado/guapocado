import { existsSync } from "node:fs";
import consola from "consola";
import { isGuapocadoGitignored, localCredentialsPath } from "./config.js";

/**
 * Warn when `.guapocado/` (which stores the saved API keys) exists but isn't
 * git-ignored, so the keys don't get committed. No-op when there are no local
 * credentials on disk, when the folder is already ignored, or when we can't
 * tell (git missing / not a repo).
 */
export function hintGitignore(cwd = process.cwd()): void {
	if (!existsSync(localCredentialsPath(cwd))) return; // nothing sensitive on disk
	if (isGuapocadoGitignored(cwd) !== false) return; // ignored, or can't tell — stay quiet
	consola.warn(".guapocado/ holds your API keys but isn't gitignored — don't commit it:");
	consola.log("  echo '.guapocado/' >> .gitignore");
}
