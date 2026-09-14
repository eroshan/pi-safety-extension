import { describe, expect, test } from "vitest";
import { validateReviewResult } from "../review/verdict.js";

const allowResult = {
	risk: "low",
	reason: "read-only command",
	recommendedAction: "allow",
} as const;

describe("review result validation", () => {
	test("accepts the prompt's exact result structure", () => {
		expect(validateReviewResult(allowResult)).toEqual({ ok: true, value: allowResult });
	});

	test.each([
		null,
		{},
		{ ...allowResult, risk: "safe" },
		{ ...allowResult, reason: "" },
		{ ...allowResult, recommendedAction: "run" },
		{ ...allowResult, extra: true },
	])("rejects malformed results: %j", (value) => {
		expect(validateReviewResult(value).ok).toBe(false);
	});
});
