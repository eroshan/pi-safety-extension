export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RecommendedAction = "allow" | "confirm" | "block";

export interface ReviewResult {
	risk: RiskLevel;
	reason: string;
	recommendedAction: RecommendedAction;
}

type ReviewResultValidation =
	| { ok: true; value: ReviewResult }
	| { ok: false; error: string };

const keys = ["risk", "reason", "recommendedAction"];
const risks = ["low", "medium", "high", "critical"];
const actions = ["allow", "confirm", "block"];

export function validateReviewResult(value: unknown): ReviewResultValidation {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, error: "review result must be an object" };
	}

	const result = value as Record<string, unknown>;
	const resultKeys = Object.keys(result);
	if (resultKeys.length !== keys.length || keys.some((key) => !resultKeys.includes(key))) {
		return { ok: false, error: `review result must contain only ${keys.join(", ")}` };
	}
	if (typeof result.risk !== "string" || !risks.includes(result.risk)) {
		return { ok: false, error: "risk is invalid" };
	}
	if (typeof result.reason !== "string" || result.reason.trim().length === 0 || result.reason.length > 500) {
		return { ok: false, error: "reason must be a non-empty string of at most 500 characters" };
	}
	if (typeof result.recommendedAction !== "string" || !actions.includes(result.recommendedAction)) {
		return { ok: false, error: "recommendedAction is invalid" };
	}

	return {
		ok: true,
		value: {
			risk: result.risk as RiskLevel,
			reason: result.reason,
			recommendedAction: result.recommendedAction as RecommendedAction,
		},
	};
}
