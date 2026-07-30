export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RecommendedAction = "allow" | "confirm" | "block";

export interface SafetyVerdict {
	risk: RiskLevel;
	reason: string;
	dependsOnPaths: boolean;
	recommendedAction: RecommendedAction;
}

const allowedKeys = ["risk", "reason", "dependsOnPaths", "recommendedAction"] as const;
type AllowedKey = (typeof allowedKeys)[number];

type VerdictValidationResult =
	| { ok: true; value: SafetyVerdict }
	| { ok: false; errors: string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object" && !Array.isArray(x);
}

export function validateSafetyVerdictStrict(x: unknown): VerdictValidationResult {
	const errors: string[] = [];

	if (!isRecord(x)) {
		return { ok: false, errors: ["root: expected an object"] };
	}

	// Unknown keys
	for (const k of Object.keys(x)) {
		if (!allowedKeys.includes(k as AllowedKey)) errors.push(`${k}: unknown property`);
	}

	// Missing keys
	for (const k of allowedKeys) {
		if (!(k in x)) errors.push(`${k}: missing`);
	}

	const risk = x.risk;
	const recommendedAction = x.recommendedAction;
	const reason = x.reason;
	const dependsOnPaths = x.dependsOnPaths;

	if (!errors.length) {
		if (typeof risk !== "string" || !["low", "medium", "high", "critical"].includes(risk)) {
			errors.push('risk: must be one of "low" | "medium" | "high" | "critical"');
		}
		if (
			typeof recommendedAction !== "string" ||
			!["allow", "confirm", "block"].includes(recommendedAction)
		) {
			errors.push('recommendedAction: must be one of "allow" | "confirm" | "block"');
		}
		if (typeof reason !== "string") {
			errors.push("reason: must be a string");
		} else if (reason.trim().length === 0) {
			errors.push("reason: must be non-empty");
		} else if (reason.length > 500) {
			errors.push("reason: must be <= 500 characters");
		}
		if (typeof dependsOnPaths !== "boolean") {
			errors.push("dependsOnPaths: must be a boolean");
		}
	}

	if (errors.length) return { ok: false, errors };

	return {
		ok: true,
		value: {
			risk: risk as RiskLevel,
			reason: reason as string,
			dependsOnPaths: dependsOnPaths as boolean,
			recommendedAction: recommendedAction as RecommendedAction,
		},
	};
}

export function isSafetyVerdict(x: unknown): x is SafetyVerdict {
	return validateSafetyVerdictStrict(x).ok;
}
