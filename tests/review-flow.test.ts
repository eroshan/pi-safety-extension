import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";

import { reviewRequest } from "../index.js";

const model = { provider: "test", id: "reviewer" } as Model<Api>;
const modelRef = { provider: "test", id: "reviewer" };
const allowResult = {
	risk: "low",
	reason: "safe",
	recommendedAction: "allow",
} as const;

function context(models: Model<Api>[] = [model], mode: "tui" | "rpc" = "tui") {
	return {
		hasUI: false,
		mode,
		cwd: "/repo",
		signal: undefined,
		abort: vi.fn(),
		ui: { select: vi.fn(), confirm: vi.fn(), custom: vi.fn(), notify: vi.fn() },
		modelRegistry: {
			getAvailable: vi.fn().mockReturnValue(models),
			complete: vi.fn(),
		},
	};
}

describe("request -> review -> review result", () => {
	test("allows only an allowlisted command after an explicit allow action from security review", async () => {
		const review = vi.fn().mockResolvedValue(allowResult);
		const ctx = context();
		await expect(reviewRequest("pwd", modelRef, ctx, review)).resolves.toBeUndefined();
		expect(review).toHaveBeenCalledOnce();
		expect(review).toHaveBeenCalledWith({ model, ctx, command: "pwd" });
	});

	test("does not let a model allow bypass the local confirmation floor", async () => {
		const review = vi.fn().mockResolvedValue(allowResult);
		const ctx = context();
		await expect(reviewRequest("npm test", modelRef, ctx, review)).resolves.toMatchObject({
			block: true,
			reason: expect.stringContaining("no UI is available"),
		});
		expect(review).toHaveBeenCalledOnce();
	});

	test("blocks a catastrophic command without sending it to the model", async () => {
		const review = vi.fn();
		await expect(reviewRequest("mkfs.ext4 /dev/sda1", modelRef, context(), review)).resolves.toMatchObject({
			block: true,
			reason: expect.stringContaining("Local safety policy"),
		});
		expect(review).not.toHaveBeenCalled();
	});

	test("declines a block action", async () => {
		const review = vi.fn().mockResolvedValue({ ...allowResult, reason: "unsafe", recommendedAction: "block" });
		await expect(reviewRequest("pwd", modelRef, context(), review)).resolves.toEqual({
			block: true,
			reason: "Safety review declined the request: unsafe",
		});
	});

	test.each(["medium", "high"] as const)("asks the user to approve %s risk", async (risk) => {
		const ctx = context();
		ctx.hasUI = true;
		ctx.ui.custom.mockResolvedValue(true);
		const review = vi.fn().mockResolvedValue({
			...allowResult,
			risk,
			reason: "needs approval",
			recommendedAction: "confirm",
		});

		await expect(reviewRequest("npm test", modelRef, ctx, review)).resolves.toBeUndefined();
		expect(ctx.ui.custom).toHaveBeenCalledOnce();
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
	});

	test("declines a model block decision without offering an override", async () => {
		const ctx = context();
		ctx.hasUI = true;
		ctx.ui.custom.mockResolvedValue(true);
		const review = vi.fn().mockResolvedValue({
			...allowResult,
			risk: "high",
			reason: "dangerous",
			recommendedAction: "block",
		});
		await expect(reviewRequest("dangerous command", modelRef, ctx, review)).resolves.toEqual({
			block: true,
			reason: "Safety review declined the request: dangerous",
		});
		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});

	test("declines confirmation when the user does not approve", async () => {
		const ctx = context();
		ctx.hasUI = true;
		ctx.ui.custom.mockResolvedValue(false);
		const review = vi.fn().mockResolvedValue({
			...allowResult,
			risk: "medium",
			reason: "needs approval",
			recommendedAction: "confirm",
		});
		const onBlockedChange = vi.fn();
		await expect(reviewRequest("npm test", modelRef, ctx, review, { onBlockedChange })).resolves.toEqual({
			block: true,
			reason: "Safety review was not approved by the user: needs approval",
			terminate: true,
		});
		expect(onBlockedChange).toHaveBeenNthCalledWith(1, true, "Safety review confirmation");
		expect(onBlockedChange).toHaveBeenNthCalledWith(2, false, "Safety review confirmation");
		expect(ctx.abort).toHaveBeenCalledOnce();
	});

	test("does not show a separate result notification", async () => {
		const ctx = context();
		await reviewRequest("pwd", modelRef, ctx, vi.fn().mockResolvedValue(allowResult));
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	test("hides action, model, and timing details by default", async () => {
		const ctx = context([model], "rpc");
		ctx.hasUI = true;
		ctx.ui.confirm.mockResolvedValue(false);
		const result = { ...allowResult, risk: "medium", recommendedAction: "confirm" } as const;
		await reviewRequest("npm test", modelRef, ctx, vi.fn().mockResolvedValue(result));
		const message = ctx.ui.confirm.mock.calls[0]?.[1] as string;
		expect(message).toContain("Risk: MEDIUM");
		expect(message).toContain("Reason: safe");
		expect(message).toContain("Request:\nnpm test");
		expect(message).not.toContain("Action:");
		expect(message).not.toContain("Model:");
		expect(message).not.toContain("Request time:");
	});

	test("shows model and timing only when debug details are enabled", async () => {
		const ctx = context([model], "rpc");
		ctx.hasUI = true;
		ctx.ui.confirm.mockResolvedValue(false);
		const result = { ...allowResult, risk: "medium", recommendedAction: "confirm" } as const;
		await reviewRequest("npm test", modelRef, ctx, vi.fn().mockResolvedValue(result), { showDebug: true });
		const message = ctx.ui.confirm.mock.calls[0]?.[1] as string;
		expect(message).toContain("Model: test/reviewer");
		expect(message).toMatch(/Request time: \d+ ms/);
		expect(message).not.toContain("Action:");
	});

	test("declines when no model is configured", async () => {
		const review = vi.fn();
		await expect(reviewRequest("pwd", undefined, context(), review)).resolves.toMatchObject({ block: true });
		expect(review).not.toHaveBeenCalled();
	});

	test("declines when the configured model is unavailable", async () => {
		const review = vi.fn();
		await expect(reviewRequest("pwd", modelRef, context([]), review)).resolves.toMatchObject({ block: true });
		expect(review).not.toHaveBeenCalled();
	});

	test("explains why a review with no response was declined", async () => {
		const review = vi.fn().mockRejectedValue(new Error("Review model returned no response"));
		await expect(reviewRequest("pwd", modelRef, context(), review)).resolves.toEqual({
			block: true,
			reason: "Safety review declined the request: Review model returned no response.",
		});
	});

	test.each([new Error("provider failed"), new Error("invalid review result")])(
		"declines when review fails: %s",
		async (error) => {
			const review = vi.fn().mockRejectedValue(error);
			await expect(reviewRequest("pwd", modelRef, context(), review)).resolves.toEqual({
				block: true,
				reason: "Safety review model did not provide a usable response; request declined.",
			});
		},
	);

	test("declines when model discovery fails", async () => {
		const ctx = context();
		ctx.modelRegistry.getAvailable.mockRejectedValue(new Error("registry unavailable"));
		await expect(reviewRequest("pwd", modelRef, ctx, vi.fn())).resolves.toMatchObject({ block: true });
	});
});
