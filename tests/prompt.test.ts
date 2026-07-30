import { describe, expect, test } from "vitest";
import { buildSafetyReviewPrompt } from "../src/review/prompt.js";
import { normalizeCommand } from "../src/analyze/normalize.js";

describe("buildSafetyReviewPrompt", () => {
	test("includes raw and normalized command", () => {
		const normalized = normalizeCommand("ls -la", "/repo");
		const p = buildSafetyReviewPrompt({ rawCommand: "ls -la", normalized, advancedSyntax: false });
		expect(p.system).toContain("Output MUST be a single JSON object");
		expect(p.user).toContain("Raw command");
		expect(p.user).toContain("ls -la");
		expect(p.user).toContain(normalized.stableCommand);
	});
});
