// Conservative whitelist for auto-allow.
// Each regexp is matched against the space-joined token string (anchored at start).
// Only fires when advancedSyntax is false, so no shell operators are present.
const WHITELIST: RegExp[] = [
	// Basic info commands
	/^(pwd|whoami|date|echo)\b/,

	// Read-only file commands
	/^(ls|cat|head|tail)\b/,

	// Search commands
	/^(rg|grep)\b/,

	// find — allowed unless -exec, -execdir, -delete, or -ok is present
	/^find\b(?!.*\s-(?:exec|execdir|delete|ok)\b)/,

	// git read-only sub-commands
	/^git (status|diff|branch|show-ref|remote)\b/,
	/^git rev-parse\b.*(--show-toplevel|--is-inside-work-tree)/,
	/^git log\b.*\s-n\s+\d+/,

	// Go toolchain
	/^go (test|build|vet|env|version)\b/,
	/^gofmt\b(?!.*\s-w\b)(?=.*\s(?:-d|-l)\b)/,

	// npm / npx
	/^npm test\b/,
	/^npm run (lint|typecheck|type-check|check|test|tsc|build)\b/,
	/^npx tsc\b(?=.*\s--noEmit\b)/,
];

export function isAutoAllowWhitelisted(tokens: string[]): boolean {
	if (!tokens || tokens.length === 0) return true; // e.g. just `cd ...`
	const cmd = tokens.join(" ");
	return WHITELIST.some((re) => re.test(cmd));
}
