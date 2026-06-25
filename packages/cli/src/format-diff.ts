import type { DiffEntry } from "@guapocado/shared";

const tty = Boolean(process.stdout.isTTY);

function ansi(s: string, code: string): string {
	return tty ? `\x1b[${code}m${s}\x1b[0m` : s;
}

const green = (s: string) => ansi(s, "32");
const red = (s: string) => ansi(s, "31");
const yellow = (s: string) => ansi(s, "33");
const dim = (s: string) => ansi(s, "2");
const bold = (s: string) => ansi(s, "1");

function isPricingPath(path: string): boolean {
	if (/^products\.[^.]+\.pricing\./.test(path)) return true;
	if (/^products\.[^.]+\.entitlements\.[^.]+\.(overage|expansion)\./.test(path)) return true;
	return false;
}

function fmtValue(v: unknown): string {
	if (v === null || v === undefined) return "(none)";
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}

export function renderDiff(diffs: DiffEntry[]): string[] {
	const lines: string[] = [];
	for (const d of diffs) {
		if (d.type === "added") {
			lines.push(green(`  + ${d.path}`));
		} else if (d.type === "removed") {
			lines.push(red(`  - ${d.path}`));
		} else {
			const values = `${dim(fmtValue(d.oldValue))} → ${yellow(fmtValue(d.newValue))}`;
			const warning = isPricingPath(d.path)
				? `  ${yellow("⚠")} existing subscribers keep current price`
				: "";
			lines.push(`  ${yellow("~")} ${d.path}  ${values}${warning}`);
		}
	}
	return lines;
}

export function renderDiffHeader(diffs: DiffEntry[], environment: string): string {
	if (diffs.length === 0) return `No config changes detected (${environment}).`;
	const noun = diffs.length === 1 ? "change" : "changes";
	return bold(`${diffs.length} ${noun} (${environment}):`);
}

export function printDiff(diffs: DiffEntry[], environment: string): void {
	console.log(renderDiffHeader(diffs, environment));
	if (diffs.length > 0) {
		console.log();
		for (const line of renderDiff(diffs)) console.log(line);
		console.log();
	}
}
