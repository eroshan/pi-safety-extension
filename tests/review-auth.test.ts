import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const completeSimpleMock = vi.fn();
vi.mock("@earendil-works/pi-ai/compat", () => ({ completeSimple: completeSimpleMock }));

const { reviewBashRequest } = await import("../review/safety-review.js");

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

const context = (auth: unknown) => ({
	cwd: "/repo",
	modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue(auth) },
});

const allowResult = {
	risk: "low",
	reason: "safe",
	recommendedAction: "allow",
} as const;
const allowJson = JSON.stringify(allowResult);

describe("reviewBashRequest", () => {
	beforeEach(() => completeSimpleMock.mockReset());

	it("sends the prompt structure and returns a valid review result", async () => {
		completeSimpleMock.mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: allowJson }],
		});
		const ctx = context({ ok: true, apiKey: "token", headers: { "X-Test": "1" } });

		await expect(reviewBashRequest({ model, ctx, command: "echo hello" })).resolves.toEqual(allowResult);
		expect(completeSimpleMock).toHaveBeenCalledWith(
			model,
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({ text: expect.stringContaining("Raw command:\necho hello") }),
						]),
					}),
				]),
			}),
			{ apiKey: "token", headers: { "X-Test": "1" } },
		);
	});

	it("fails when model authentication is unavailable", async () => {
		await expect(reviewBashRequest({ model, ctx: context({ ok: true }), command: "pwd" }))
			.rejects.toThrow("authentication is unavailable");
		expect(completeSimpleMock).not.toHaveBeenCalled();
	});

	it.each(["", "not json", `${allowJson.slice(0, -1)},"extra":1}`])(
		"fails closed on invalid model output: %j",
		async (text) => {
			completeSimpleMock.mockResolvedValue({
				stopReason: "stop",
				content: [{ type: "text", text }],
			});
			await expect(reviewBashRequest({
				model,
				ctx: context({ ok: true, apiKey: "token" }),
				command: "pwd",
			})).rejects.toThrow();
		},
	);

	it("fails closed when the model does not complete successfully", async () => {
		completeSimpleMock.mockResolvedValue({
			stopReason: "error",
			content: [{ type: "text", text: allowJson }],
		});
		await expect(reviewBashRequest({
			model,
			ctx: context({ ok: true, apiKey: "token" }),
			command: "pwd",
		})).rejects.toThrow("did not complete successfully");
	});
});
