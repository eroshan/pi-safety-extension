import type { Api, Model, UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildSafetyReviewPrompt } from "./prompt.js";
import { validateReviewResult, type ReviewResult } from "./verdict.js";

const REVIEW_TIMEOUT_MS = 30_000;
const REVIEW_MAX_TOKENS = 500;

type ReviewContext = Pick<ExtensionContext, "cwd" | "signal"> & {
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "complete">;
};

function extractText(response: unknown): string {
	if (!response || typeof response !== "object") return "";
	const content = (response as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } =>
			!!block && typeof block === "object" &&
			(block as { type?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string")
		.map((block) => block.text)
		.join("")
		.trim();
}

function reviewSignal(parent: AbortSignal | undefined): AbortSignal {
	const timeout = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
	return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function isAuthenticationError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /(?:api key|auth(?:entication|orization)?|credential|provider is not configured)/i.test(error.message);
}

export async function reviewBashRequest(args: {
	model: Model<Api>;
	ctx: ReviewContext;
	command: string;
}): Promise<ReviewResult> {
	if (typeof args.ctx.modelRegistry.complete !== "function") {
		throw new Error("Safety review requires Pi 0.84.2 or newer");
	}

	const prompt = buildSafetyReviewPrompt({
		rawCommand: args.command,
		cwd: args.ctx.cwd,
	});
	const messages: UserMessage[] = [{
		role: "user",
		content: [{ type: "text", text: prompt.user }],
		timestamp: Date.now(),
	}];

	let response: unknown;
	try {
		response = await args.ctx.modelRegistry.complete(
			args.model,
			{ systemPrompt: prompt.system, messages },
			{
				maxRetries: 0,
				maxTokens: REVIEW_MAX_TOKENS,
				signal: reviewSignal(args.ctx.signal),
				timeoutMs: REVIEW_TIMEOUT_MS,
			},
		);
	} catch (error) {
		if (isAuthenticationError(error)) {
			throw new Error("Review model authentication is unavailable", { cause: error });
		}
		throw error;
	}

	if (!response || typeof response !== "object" || (response as { stopReason?: unknown }).stopReason !== "stop") {
		throw new Error("Review model did not complete successfully");
	}

	const text = extractText(response);
	if (!text) throw new Error("Review model returned no response");

	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new Error("Review model returned invalid JSON");
	}
	const result = validateReviewResult(parsed);
	if (!result.ok) throw new Error(`Review model returned an invalid result: ${result.error}`);
	return result.value;
}
