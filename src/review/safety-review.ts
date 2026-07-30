import { completeSimple, type Model, type Api, type UserMessage } from "@earendil-works/pi-ai/compat";

import type { NormalizedCommand } from "../analyze/normalize.js";
import { buildSafetyReviewPrompt } from "./prompt.js";
import { validateSafetyVerdictStrict, type SafetyVerdict } from "./verdict.js";

type DebugLogger = { log: (event: string, data?: unknown) => void };

type ReviewContext = {
	modelRegistry: {
		getApiKeyAndHeaders: (model: Model<Api>) => Promise<
			| { ok: true; apiKey?: string; headers?: Record<string, string> }
			| { ok: false; error: string }
		>;
	};
};

const VERDICT_SCHEMA_TEXT = `{
  "risk": "low" | "medium" | "high" | "critical",
  "reason": "<non-empty string>",
  "dependsOnPaths": true | false,
  "recommendedAction": "allow" | "confirm" | "block"
}`;

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

type TextBlock = { type: "text"; text: string };

function isRecord(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object" && !Array.isArray(x);
}

function isTextBlock(x: unknown): x is TextBlock {
	if (!isRecord(x)) return false;
	return x.type === "text" && typeof x.text === "string";
}

function extractText(message: unknown): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(isTextBlock)
		.map((b) => b.text)
		.join("")
		.trim();
}

function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	return `${s.slice(0, maxLen)}\n... (truncated, total ${s.length} chars)`;
}

function parseAndValidateVerdict(text: string): { verdict?: SafetyVerdict; jsonText: string; error?: string } {
	// Try to be resilient to accidental preamble.
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	const jsonText = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText) as unknown;
	} catch (e: unknown) {
		return {
			jsonText,
			error: `JSON.parse failed: ${errorMessage(e)}`,
		};
	}

	const validated = validateSafetyVerdictStrict(parsed);
	if (!validated.ok) {
		return {
			jsonText,
			error: `Schema validation failed:\n- ${validated.errors.join("\n- ")}`,
		};
	}

	return { jsonText, verdict: validated.value };
}

function buildRepairPrompt(args: { error: string; previousOutput: string }): string {
	return `Your previous response did NOT match the required JSON schema.

Validation error:
${args.error}

Required schema (strict; no extra keys; no markdown; output ONLY the JSON object):
${VERDICT_SCHEMA_TEXT}

Your previous output (for reference):
${truncate(args.previousOutput, 2000)}

Now output ONLY a single JSON object matching the schema exactly.`;
}

async function resolveRequestAuth(
	modelRegistry: ReviewContext["modelRegistry"],
	model: Model<Api>,
): Promise<{ apiKey?: string; headers?: Record<string, string> }> {
	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(auth.error);
	}
	if (!auth.apiKey && (!auth.headers || Object.keys(auth.headers).length === 0)) {
		throw new Error(`No configured auth for review model ${model.provider}/${model.id}`);
	}
	return { apiKey: auth.apiKey, headers: auth.headers };
}

export async function reviewBashCommand(args: {
	model: Model<Api>;
	ctx: ReviewContext;
	rawCommand: string;
	normalized: NormalizedCommand;
	advancedSyntax: boolean;
	debug: DebugLogger;
}): Promise<SafetyVerdict> {
	const { model, ctx, rawCommand, normalized, advancedSyntax, debug } = args;
	const { apiKey, headers } = await resolveRequestAuth(ctx.modelRegistry, model);

	const prompt = buildSafetyReviewPrompt({ rawCommand, normalized, advancedSyntax });

	debug.log("review_request", {
		model: `${model.provider}/${model.id}`,
		baseKey: normalized.baseKey,
		fingerprintKey: normalized.fingerprintKey,
	});

	// First attempt + 2 retries (per requirements)
	const maxAttempts = 3;
	const messages: UserMessage[] = [{ role: "user", content: [{ type: "text", text: prompt.user }], timestamp: Date.now() }];

	let lastError = "Unknown error";

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const response = await completeSimple(
			model,
			{
				systemPrompt: prompt.system,
				messages,
			},
			{ apiKey, headers },
		);

		const text = extractText(response as unknown);

		const parsed = parseAndValidateVerdict(text);
		if (parsed.verdict) {
			debug.log("review_response", { verdict: parsed.verdict, attempt });
			return parsed.verdict;
		}

		lastError = parsed.error ?? "Unknown parse/validation error";
		debug.log("review_invalid_response", {
			attempt,
			error: lastError,
			outputPreview: truncate(text, 400),
		});

		if (attempt < maxAttempts) {
			messages.push({
				role: "user",
				content: [{ type: "text", text: buildRepairPrompt({ error: lastError, previousOutput: text }) }],
				timestamp: Date.now(),
			});
			continue;
		}
	}

	// Do not include the raw model output in the thrown error to avoid leaking it into logs/audit trails.
	throw new Error(`Safety review returned invalid JSON after ${maxAttempts} attempts. Last error: ${lastError}`);
}
