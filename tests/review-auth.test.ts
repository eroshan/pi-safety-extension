import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reviewBashRequest } from "../review/safety-review.js";

const model = {
	provider: "openai",
	id: "gpt-4.1-mini",
	api: "openai-responses",
	name: "GPT-4.1 mini",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
} satisfies Model<Api>;

const allowResult = {
	risk: "low",
	reason: "safe",
	recommendedAction: "allow",
} as const;
const allowJson = JSON.stringify(allowResult);

function response(text: string = allowJson, stopReason = "stop") {
	return { stopReason, content: [{ type: "text", text }] };
}

function context(complete = vi.fn().mockResolvedValue(response()), signal?: AbortSignal) {
	return {
		cwd: "/repo",
		signal,
		modelRegistry: { complete },
	};
}

describe("reviewBashRequest", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses the model registry completion path and returns a valid result", async () => {
		const ctx = context();

		await expect(reviewBashRequest({ model, ctx, command: "echo hello" })).resolves.toEqual(allowResult);
		expect(ctx.modelRegistry.complete).toHaveBeenCalledWith(
			model,
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({ text: expect.stringContaining('"command": "echo hello"') }),
						]),
					}),
				]),
			}),
			expect.objectContaining({
				maxRetries: 0,
				maxTokens: 500,
				signal: expect.any(AbortSignal),
				timeoutMs: 30_000,
			}),
		);
	});

	it("does not require an API key or headers before invoking the registry", async () => {
		const ctx = context();
		await expect(reviewBashRequest({ model, ctx, command: "pwd" })).resolves.toEqual(allowResult);
		expect(ctx.modelRegistry.complete).toHaveBeenCalledOnce();
	});

	it("classifies registry authentication failures", async () => {
		const ctx = context(vi.fn().mockRejectedValue(new Error("No API key found for openai")));
		await expect(reviewBashRequest({ model, ctx, command: "pwd" }))
			.rejects.toThrow("Review model authentication is unavailable");
	});

	it("passes cancellation from the active Pi turn to the registry request", async () => {
		const controller = new AbortController();
		const complete = vi.fn((_model, _request, options: { signal: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
			}));
		const pending = reviewBashRequest({ model, ctx: context(complete, controller.signal), command: "pwd" });

		controller.abort(new Error("cancelled by user"));
		await expect(pending).rejects.toThrow("cancelled by user");
	});

	it("reports when the review model returns no response", async () => {
		const ctx = context(vi.fn().mockResolvedValue({ stopReason: "stop", content: [] }));
		await expect(reviewBashRequest({ model, ctx, command: "pwd" }))
			.rejects.toThrow("Review model returned no response");
	});

	it.each(["not json", `${allowJson.slice(0, -1)},"extra":1}`])(
		"fails closed on invalid model output: %j",
		async (text) => {
			const ctx = context(vi.fn().mockResolvedValue(response(text)));
			await expect(reviewBashRequest({ model, ctx, command: "pwd" })).rejects.toThrow();
		},
	);

	it("fails closed when the model does not complete successfully", async () => {
		const ctx = context(vi.fn().mockResolvedValue(response(allowJson, "error")));
		await expect(reviewBashRequest({ model, ctx, command: "pwd" }))
			.rejects.toThrow("did not complete successfully");
	});
});
