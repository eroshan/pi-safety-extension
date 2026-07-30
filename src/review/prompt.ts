import type { NormalizedCommand } from "../analyze/normalize.js";

export function buildSafetyReviewPrompt(args: {
	rawCommand: string;
	normalized: NormalizedCommand;
	advancedSyntax: boolean;
}) {
	const { rawCommand, normalized, advancedSyntax } = args;

	return {
		system: `You are a conservative security reviewer for shell commands.

You will be given a bash command that an LLM wants to run. Your job is to decide the risk and the recommended action.

Rules:
- Output MUST be a single JSON object and nothing else (no markdown, no code fences).
- Be conservative: if unsure, increase risk.
- Consider: data loss (rm/mv), privilege escalation (sudo), credential leaks, network exfiltration (curl/wget), modifying files, installs, process control, killing processes, deleting repos.
- If the risk depends on *specific paths/targets* (e.g. rm of a path, writing files, redirecting output to a file), set dependsOnPaths=true.
- If advanced shell syntax is present (pipes, redirects, chaining, subshells, command substitution), treat as higher risk unless clearly harmless.

Return schema:
{
  "risk": "low" | "medium" | "high" | "critical",
  "reason": "...",
  "dependsOnPaths": true | false,
  "recommendedAction": "allow" | "confirm" | "block"
}
`,
		user: `Raw command:\n${rawCommand}\n\nAdvanced shell syntax detected: ${advancedSyntax}\n\nEffective CWD: ${normalized.effectiveCwd}\n\nNormalized command (for caching):\n${normalized.stableCommand}\n\nNormalized tokens:\n${JSON.stringify(normalized.stableTokens)}\n`,
	};
}
