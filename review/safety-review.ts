import { completeSimple, type Api, type Model, type UserMessage } from "@earendil-works/pi-ai/compat";

import { buildSafetyReviewPrompt } from "./prompt.js";
import { validateReviewResult, type ReviewResult } from "./verdict.js";

type ReviewContext = {
	cwd: string;
	modelRegistry: {
		getApiKeyAndHeaders: (model: Model<Api>) => Promise<
			| { ok: true; apiKey?: string; headers?: Record<string, string | null> }
			| { ok: false; error: string }
		>;
	};
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

export async function reviewBashRequest(args: {
	model: Model<Api>;
	ctx: ReviewContext;
	command: string;
}): Promise<ReviewResult> {
	const auth = await args.ctx.modelRegistry.getApiKeyAndHeaders(args.model);
	if (!auth.ok) throw new Error("Review model authentication is unavailable");
	if (!auth.apiKey && (!auth.headers || Object.keys(auth.headers).length === 0)) {
		throw new Error("Review model authentication is unavailable");
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
	const response = await completeSimple(
		args.model,
		{ systemPrompt: prompt.system, messages },
		{ apiKey: auth.apiKey, headers: auth.headers },
	);
	if (response.stopReason !== "stop") {
		throw new Error("Review model did not complete successfully");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(extractText(response)) as unknown;
	} catch {
		throw new Error("Review model returned invalid JSON");
	}
	const result = validateReviewResult(parsed);
	if (!result.ok) throw new Error(`Review model returned an invalid result: ${result.error}`);
	return result.value;
}
