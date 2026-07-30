import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedCommand } from "../src/analyze/normalize.js";

const completeSimpleMock = vi.fn();

vi.mock("@earendil-works/pi-ai/compat", () => ({
	completeSimple: completeSimpleMock,
}));

const { reviewBashCommand } = await import("../src/review/safety-review.js");

describe("reviewBashCommand auth resolution", () => {

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

	const normalized: NormalizedCommand = {
		raw: "echo hello",
		baseKey: "echo",
		fingerprintKey: "echo hello",
		effectiveCwd: "/tmp",
		tokensAfterCd: ["echo", "hello"],
		stableCommand: "echo hello",
		stableTokens: ["echo", "hello"],
	};

	const debug = { log: vi.fn() };

	beforeEach(() => {
		completeSimpleMock.mockReset();
		debug.log.mockClear();
		completeSimpleMock.mockResolvedValue({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						risk: "low",
						reason: "safe",
						dependsOnPaths: false,
						recommendedAction: "allow",
					}),
				},
			],
		});
	});

	it("uses getApiKeyAndHeaders when available", async () => {
		await reviewBashCommand({
			model,
			ctx: {
				modelRegistry: {
					getApiKeyAndHeaders: vi.fn().mockResolvedValue({
						ok: true,
						apiKey: "token",
						headers: { Authorization: "Bearer token", "X-Test": "1" },
					}),
				},
			},
			rawCommand: "echo hello",
			normalized,
			advancedSyntax: false,
			debug,
		});

		expect(completeSimpleMock).toHaveBeenCalledTimes(1);
		expect(completeSimpleMock).toHaveBeenCalledWith(
			model,
			expect.any(Object),
				expect.objectContaining({
				apiKey: "token",
				headers: { Authorization: "Bearer token", "X-Test": "1" },
			}),
		);
	});

	it("throws when no auth is configured for the model", async () => {
		await expect(
			reviewBashCommand({
				model,
				ctx: {
					modelRegistry: {
						getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true }),
					},
				},
				rawCommand: "echo hello",
				normalized,
				advancedSyntax: false,
				debug,
			}),
		).rejects.toThrow("No configured auth for review model openai/gpt-4.1-mini");
	});
});
