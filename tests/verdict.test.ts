import { describe, expect, test } from "vitest";
import { isSafetyVerdict, validateSafetyVerdictStrict } from "../src/review/verdict.js";

describe("SafetyVerdict validation", () => {
	test("accepts valid verdict", () => {
		expect(
			isSafetyVerdict({
				risk: "medium",
				reason: "needs confirmation",
				dependsOnPaths: true,
				recommendedAction: "confirm",
			}),
		).toBe(true);
	});

	test("rejects invalid values", () => {
		expect(isSafetyVerdict(null)).toBe(false);
		expect(isSafetyVerdict({})).toBe(false);
		expect(isSafetyVerdict({ risk: "nope", reason: "x", dependsOnPaths: true, recommendedAction: "allow" })).toBe(false);
		expect(isSafetyVerdict({ risk: "low", reason: 1, dependsOnPaths: true, recommendedAction: "allow" })).toBe(false);
		expect(isSafetyVerdict({ risk: "low", reason: "x", dependsOnPaths: "no", recommendedAction: "allow" })).toBe(false);
	});

	test("strict mode: rejects extra keys", () => {
		const v = validateSafetyVerdictStrict({
			risk: "low",
			reason: "ok",
			dependsOnPaths: false,
			recommendedAction: "allow",
			extra: 123,
		});
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.errors.join("\n")).toContain("extra: unknown property");
	});

	test("strict mode: rejects empty reason", () => {
		const v = validateSafetyVerdictStrict({
			risk: "low",
			reason: "   ",
			dependsOnPaths: false,
			recommendedAction: "allow",
		});
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.errors.join("\n")).toContain("reason: must be non-empty");
	});

	test("strict mode: rejects overly long reason", () => {
		const v = validateSafetyVerdictStrict({
			risk: "low",
			reason: "x".repeat(501),
			dependsOnPaths: false,
			recommendedAction: "allow",
		});
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.errors.join("\n")).toContain("reason: must be <= 500 characters");
	});
});
