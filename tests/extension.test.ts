import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";

import safetyExtension from "../index.js";

type EventHandler = (event: unknown, ctx: unknown) => Promise<unknown>;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;
type EntryRenderer = (...args: unknown[]) => unknown;

const oldModel = { provider: "test", id: "old", name: "Old reviewer" } as Model<Api> & { name: string };
const selectedModel = { provider: "test", id: "selected", name: "Selected reviewer" } as Model<Api> & { name: string };

function harness() {
	const events = new Map<string, EventHandler>();
	const commands = new Map<string, CommandHandler>();
	const renderers = new Map<string, EntryRenderer>();
	const appendEntry = vi.fn();
	const pi = {
		on: (name: string, handler: EventHandler) => events.set(name, handler),
		registerCommand: (name: string, command: { handler: CommandHandler }) => commands.set(name, command.handler),
		registerEntryRenderer: (name: string, renderer: EntryRenderer) => renderers.set(name, renderer),
		appendEntry,
	} as unknown as ExtensionAPI;
	return { pi, events, commands, renderers, appendEntry };
}

function context() {
	return {
		hasUI: true,
		mode: "tui" as const,
		cwd: "/repo",
		ui: {
			select: vi.fn().mockResolvedValue("test/selected — Selected reviewer"),
			confirm: vi.fn(),
			custom: vi.fn(),
			notify: vi.fn(),
		},
		modelRegistry: {
			getAvailable: vi.fn().mockResolvedValue([oldModel, selectedModel]),
			getApiKeyAndHeaders: vi.fn(),
		},
	};
}

describe("safety extension model selection and self-test", () => {
	test("uses a newly selected model immediately for reviews and self-tests", async () => {
		const { pi, events, commands, renderers, appendEntry } = harness();
		const reviewResult = {
			risk: "low",
			reason: "safe",
			recommendedAction: "allow",
		} as const;
		const review = vi.fn().mockResolvedValue(reviewResult);
		const saveModel = vi.fn().mockResolvedValue(undefined);
		const ctx = context();
		safetyExtension(pi, {
			review,
			loadModel: vi.fn().mockResolvedValue({ provider: "test", id: "old" }),
			saveModel,
		});

		await events.get("session_start")?.({}, ctx);
		await commands.get("safety-setup")?.("", ctx);
		await commands.get("safety-review-debug-toggle")?.("", ctx);
		await events.get("tool_call")?.({ toolName: "bash", input: { command: "pwd" } }, ctx);
		await commands.get("safety-review-selftest")?.("echo test", ctx);

		expect(saveModel).toHaveBeenCalledWith({ provider: "test", id: "selected" });
		expect(renderers.has("safety-review-auto-approved")).toBe(true);
		expect(appendEntry).toHaveBeenCalledWith("safety-review-auto-approved");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Safety review debug details: on", "info");
		expect(review).toHaveBeenNthCalledWith(1, { model: selectedModel, ctx, command: "pwd" });
		expect(review).toHaveBeenNthCalledWith(2, { model: selectedModel, ctx, command: "echo test" });
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Model: test/selected — Selected reviewer"),
			"info",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining(`Output:\n${JSON.stringify(reviewResult)}`),
			"info",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringMatching(/Request time: \d+ ms[\s\S]*Request:\necho test/),
			"info",
		);
	});

	test("production mode confirms every command without calling the AI reviewer", async () => {
		const { pi, events, commands } = harness();
		const review = vi.fn();
		const ctx = context();
		ctx.ui.custom.mockResolvedValue(true);
		safetyExtension(pi, {
			review,
			loadModel: vi.fn().mockResolvedValue({ provider: "test", id: "old" }),
			saveModel: vi.fn(),
		});

		await events.get("session_start")?.({}, ctx);
		await commands.get("security-review-prod-toggle")?.("", ctx);
		const decision = await events.get("tool_call")?.(
			{ toolName: "bash", input: { command: "deploy production" } },
			ctx,
		);

		expect(decision).toBeUndefined();
		expect(review).not.toHaveBeenCalled();
		expect(ctx.ui.custom).toHaveBeenCalledOnce();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Production security review: on", "info");
	});

	test("production mode declines without UI and does not call the AI reviewer", async () => {
		const { pi, events, commands } = harness();
		const review = vi.fn();
		const ctx = context();
		ctx.hasUI = false;
		safetyExtension(pi, {
			review,
			loadModel: vi.fn().mockResolvedValue(undefined),
			saveModel: vi.fn(),
		});

		await events.get("session_start")?.({}, ctx);
		await commands.get("security-review-prod-toggle")?.("", ctx);
		const decision = await events.get("tool_call")?.(
			{ toolName: "bash", input: { command: "pwd" } },
			ctx,
		);

		expect(decision).toEqual({
			block: true,
			reason: "Production mode requires confirmation, but no UI is available.",
		});
		expect(review).not.toHaveBeenCalled();
		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});
});
