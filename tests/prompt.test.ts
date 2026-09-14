import { describe, expect, test } from "vitest";
import { buildSafetyReviewPrompt } from "../review/prompt.js";

describe("buildSafetyReviewPrompt", () => {
	test("uses the required prompt structure", () => {
		const prompt = buildSafetyReviewPrompt({
			rawCommand: "echo hello && rm -rf /tmp/example",
			cwd: "/repo",
		});
		expect(prompt.system).toContain('"risk": "low" | "medium" | "high" | "critical"');
		expect(prompt.system).toContain('"recommendedAction": "allow" | "confirm" | "block"');
		expect(prompt.user).toContain("CWD: /repo");
		expect(prompt.user).toContain("echo hello && rm -rf /tmp/example");
		expect(prompt.user).not.toContain("Normalized");
	});
});
