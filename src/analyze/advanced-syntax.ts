// Very conservative scan for advanced shell features that tend to increase risk.
// Intentionally does not try to be a full shell parser.

const patterns: Array<{ name: string; re: RegExp }> = [
	{ name: "pipe", re: /\|/ },
	{ name: "and", re: /&&/ },
	{ name: "or", re: /\|\|/ },
	{ name: "semicolon", re: /;/ },
	{ name: "newline", re: /\n/ },
	{ name: "redir_out", re: />/ },
	{ name: "redir_in", re: /</ },
	{ name: "cmdsub_dollar", re: /\$\([^)]*\)/ },
	{ name: "cmdsub_backtick", re: /`[^`]*`/ },
	{ name: "group_paren", re: /\([^)]*\)/ },
	{ name: "group_brace", re: /\{[^}]*\}/ },
];

export function hasAdvancedShellSyntax(raw: string): boolean {
	const s = raw ?? "";
	return patterns.some((p) => p.re.test(s));
}
