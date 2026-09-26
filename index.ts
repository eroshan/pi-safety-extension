import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Spacer, Text, type SelectItem } from "@earendil-works/pi-tui";

import { classifyBashCommand, mergeReviewResults } from "./review/policy.js";
import { reviewBashRequest } from "./review/safety-review.js";
import { loadReviewModel, saveReviewModel, type ReviewModelRef } from "./review/state.js";
import type { ReviewResult } from "./review/verdict.js";

type AvailableModel = Model<Api> & { name?: string };

type ExtensionCtx = Pick<ExtensionContext, "abort" | "cwd" | "hasUI" | "mode" | "signal"> & {
	ui: Pick<ExtensionContext["ui"], "confirm" | "custom" | "notify" | "select">;
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "complete" | "getAvailable">;
};

type Review = (args: {
	model: Model<Api>;
	ctx: ExtensionCtx;
	command: string;
}) => Promise<ReviewResult>;

type SafetyExtensionDependencies = {
	review?: Review;
	loadModel?: () => Promise<ReviewModelRef | undefined>;
	saveModel?: (model: ReviewModelRef) => Promise<void>;
};

type BlockedChange = (active: boolean, label: string) => void;

type Blocked = { block: true; reason: string; terminate?: true };
type CompletedReview = { model: AvailableModel; result: ReviewResult; elapsedMs: number };

const NO_MODEL_REASON = "Safety review model is not configured or unavailable; request declined.";
const REVIEW_FAILED_REASON = "Safety review model did not provide a usable response; request declined.";
const CONFIRMATION_TIMEOUT_MS = 120_000;
const REVIEW_MODEL_FAILURES = new Set([
	"Review model authentication is unavailable",
	"Review model did not complete successfully",
	"Review model returned no response",
	"Review model returned invalid JSON",
	"Safety review requires Pi 0.84.2 or newer",
]);

function reviewFailureReason(error: unknown): string {
	if (error instanceof Error && REVIEW_MODEL_FAILURES.has(error.message)) {
		return `Safety review declined the request: ${error.message}.`;
	}
	return REVIEW_FAILED_REASON;
}

function modelLabel(model: Pick<AvailableModel, "provider" | "id" | "name">): string {
	return `${model.provider}/${model.id}${model.name ? ` — ${model.name}` : ""}`;
}

async function runReview(
	command: string,
	modelRef: ReviewModelRef | undefined,
	ctx: ExtensionCtx,
	review: Review,
): Promise<CompletedReview> {
	if (!modelRef) throw new Error(NO_MODEL_REASON);
	const available = await Promise.resolve(ctx.modelRegistry.getAvailable());
	const model = available.find(({ provider, id }) => provider === modelRef.provider && id === modelRef.id);
	if (!model) throw new Error(NO_MODEL_REASON);
	const startedMs = Date.now();
	const result = await review({ model, ctx, command });
	return { model, result, elapsedMs: Date.now() - startedMs };
}

function formatReviewResult(command: string, completed: CompletedReview, showDebug: boolean): string {
	const debug = showDebug
		? `Model: ${modelLabel(completed.model)}\nRequest time: ${completed.elapsedMs} ms\n`
		: "";
	return `${debug}Risk: ${completed.result.risk.toUpperCase()}\nReason: ${completed.result.reason}\nRequest:\n${command}`;
}

function handleConfirmationInput(data: string, choices: SelectList): void {
	if (matchesKey(data, "j")) {
		choices.setSelectedIndex(1);
	} else if (matchesKey(data, "k")) {
		choices.setSelectedIndex(0);
	} else {
		choices.handleInput(data);
	}
}

function emitBlockedChange(pi: ExtensionAPI, active: boolean, label: string): void {
	const data = { active, label, source: "safety-extension" };
	pi.events.emit("agent:blocked", data);
	pi.events.emit("herdr:blocked", data);
}

async function confirmProductionCommand(ctx: ExtensionCtx, command: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	if (ctx.mode !== "tui") {
		return ctx.ui.confirm(
			"Production security review",
			`Production mode requires confirmation for every command.\n\nRequest:\n${command}\n\nAllow execution?`,
			{ signal: ctx.signal, timeout: CONFIRMATION_TIMEOUT_MS },
		);
	}

	return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("error", text)));
		container.addChild(new Text(
			`${theme.fg("muted", "Mode:")} ${theme.fg("error", theme.bold("PRODUCTION"))}`,
			1,
			0,
		));
		container.addChild(new Text(theme.fg("accent", theme.bold("Request:")), 1, 0));
		container.addChild(new Text(
			command.split("\n").map((line) => theme.fg("syntaxString", `  ${line}`)).join("\n"),
			1,
			0,
		));

		const items: SelectItem[] = [
			{ value: "decline", label: "Decline", description: "Do not execute the command" },
			{ value: "allow", label: "Allow", description: "Execute this command without AI review" },
		];
		const choices = new SelectList(items, items.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		choices.onSelect = (item) => done(item.value === "allow");
		choices.onCancel = () => done(false);
		container.addChild(new Spacer(1));
		container.addChild(choices);
		container.addChild(new Text(theme.fg("dim", "↑↓/jk navigate • enter select • esc decline"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("error", text)));

		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleConfirmationInput(data, choices);
				tui.requestRender();
			},
		};
	});
}

async function confirmReview(
	ctx: ExtensionCtx,
	command: string,
	completed: CompletedReview,
	assessment: string,
	showDebug: boolean,
): Promise<boolean> {
	const { risk, reason } = completed.result;
	if (ctx.mode !== "tui") {
		return ctx.ui.confirm(
			`Safety review: ${risk} risk`,
			`${assessment}\n\nAllow execution?`,
			{ signal: ctx.signal, timeout: CONFIRMATION_TIMEOUT_MS },
		);
	}

	return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
		const container = new Container();
		const riskColor = risk === "medium" ? "warning" : "error";
		const field = (label: string, value: string) =>
			`${theme.fg("muted", `${label}:`)} ${theme.fg("text", value)}`;
		container.addChild(new DynamicBorder((text: string) => theme.fg(riskColor, text)));
		const riskField = `${theme.fg("muted", "Risk:")} ${theme.fg(riskColor, theme.bold(risk.toUpperCase()))}`;
		const fields = [riskField, field("Reason", reason)];
		if (showDebug) {
			fields.unshift(
				field("Model", modelLabel(completed.model)),
				field("Request time", `${completed.elapsedMs} ms`),
			);
		}
		container.addChild(new Text(fields.join("\n"), 1, 0));
		container.addChild(new Text(theme.fg("accent", theme.bold("Request:")), 1, 0));
		container.addChild(new Text(
			command.split("\n").map((line) => theme.fg("syntaxString", `  ${line}`)).join("\n"),
			1,
			0,
		));

		const items: SelectItem[] = [
			{ value: "decline", label: "Decline", description: "Do not execute the command" },
			{ value: "allow", label: "Allow", description: "Execute this reviewed command" },
		];
		const choices = new SelectList(items, items.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		choices.onSelect = (item) => done(item.value === "allow");
		choices.onCancel = () => done(false);
		container.addChild(new Spacer(1));
		container.addChild(choices);
		container.addChild(new Text(theme.fg("dim", "↑↓/jk navigate • enter select • esc decline"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg(riskColor, text)));

		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleConfirmationInput(data, choices);
				tui.requestRender();
			},
		};
	});
}

export async function reviewRequest(
	command: string,
	modelRef: ReviewModelRef | undefined,
	ctx: ExtensionCtx,
	review: Review = reviewBashRequest,
	options: { showDebug?: boolean; onAutoApproved?: () => void; onBlockedChange?: BlockedChange } = {},
): Promise<Blocked | undefined> {
	try {
		const localResult = classifyBashCommand(command);
		if (localResult.recommendedAction === "block") {
			return { block: true, reason: `Safety review declined the request: ${localResult.reason}` };
		}

		const reviewed = await runReview(command, modelRef, ctx, review);
		const completed = { ...reviewed, result: mergeReviewResults(localResult, reviewed.result) };
		const { result } = completed;
		const assessment = formatReviewResult(command, completed, options.showDebug ?? false);

		if (result.risk === "critical" || result.recommendedAction === "block") {
			return { block: true, reason: `Safety review declined the request: ${result.reason}` };
		}

		const requiresConfirmation =
			result.risk === "medium" || result.risk === "high" || result.recommendedAction === "confirm";
		if (requiresConfirmation) {
			if (!ctx.hasUI) {
				return { block: true, reason: `Safety review requires confirmation, but no UI is available: ${result.reason}` };
			}
			const label = "Safety review confirmation";
			options.onBlockedChange?.(true, label);
			let allowed = false;
			try {
				allowed = await confirmReview(
					ctx,
					command,
					completed,
					assessment,
					options.showDebug ?? false,
				);
			} finally {
				options.onBlockedChange?.(false, label);
			}
			if (!allowed) {
				ctx.abort();
				return {
					block: true,
					reason: `Safety review was not approved by the user: ${result.reason}`,
					terminate: true,
				};
			}
			return undefined;
		}

		if (result.recommendedAction === "allow") {
			options.onAutoApproved?.();
			return undefined;
		}
		return { block: true, reason: `Safety review declined the request: ${result.reason}` };
	} catch (error) {
		return {
			block: true,
			reason: error instanceof Error && error.message === NO_MODEL_REASON
				? NO_MODEL_REASON
				: reviewFailureReason(error),
		};
	}
}

export default function safetyExtension(pi: ExtensionAPI, dependencies: SafetyExtensionDependencies = {}) {
	const review = dependencies.review ?? reviewBashRequest;
	const loadModel = dependencies.loadModel ?? loadReviewModel;
	const saveModel = dependencies.saveModel ?? saveReviewModel;
	let reviewModel: ReviewModelRef | undefined;
	let showDebug = false;
	let productionMode = false;

	pi.registerEntryRenderer("safety-review-auto-approved", (_entry, _options, theme) =>
		new Text(theme.fg("mdLink", theme.bold("safety-review: auto-approved")), 1, 0));

	pi.on("session_start", async () => {
		reviewModel = await loadModel();
	});

	pi.registerCommand("safety-setup", {
		description: "Select the model used for bash safety reviews",
		handler: async (_args, ctx: ExtensionCtx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Safety setup requires an interactive session.", "error");
				return;
			}
			try {
				const available = await Promise.resolve(ctx.modelRegistry.getAvailable());
				const options = available.map(modelLabel);
				const selected = await ctx.ui.select("Select a safety review model", options);
				const index = selected ? options.indexOf(selected) : -1;
				if (index < 0) return;

				const selectedModel = available[index];
				const nextModel = { provider: selectedModel.provider, id: selectedModel.id };
				await saveModel(nextModel);
				reviewModel = nextModel;
				ctx.ui.notify(`Safety review model: ${modelLabel(selectedModel)}`, "info");
			} catch {
				ctx.ui.notify("Could not configure the safety review model.", "error");
			}
		},
	});

	pi.registerCommand("safety-review-debug-toggle", {
		description: "Toggle model and timing details in safety review dialogs",
		handler: async (_args, ctx: ExtensionCtx) => {
			showDebug = !showDebug;
			ctx.ui.notify(`Safety review debug details: ${showDebug ? "on" : "off"}`, "info");
		},
	});

	pi.registerCommand("security-review-prod-toggle", {
		description: "Toggle confirmation of every bash command without AI review",
		handler: async (_args, ctx: ExtensionCtx) => {
			productionMode = !productionMode;
			ctx.ui.notify(`Production security review: ${productionMode ? "on" : "off"}`, "info");
		},
	});

	pi.registerCommand("safety-review-selftest", {
		description: "Send a test request to the selected safety review model",
		handler: async (args, ctx: ExtensionCtx) => {
			const command = args.trim() || "pwd";
			const startedAt = new Date();
			const startedMs = Date.now();
			const selectedLabel = reviewModel
				? `${reviewModel.provider}/${reviewModel.id}`
				: "not configured";
			ctx.ui.notify(
				`Safety review self-test request\nModel: ${selectedLabel}\nStarted: ${startedAt.toISOString()}\nRequest:\n${command}`,
				"info",
			);

			try {
				const { model, result, elapsedMs } = await runReview(command, reviewModel, ctx, review);
				ctx.ui.notify(
					`Safety review self-test result\nModel: ${modelLabel(model)}\nRequest time: ${elapsedMs} ms\nRequest:\n${command}\nOutput:\n${JSON.stringify(result)}`,
					result.recommendedAction === "allow" ? "info" : "warning",
				);
			} catch {
				ctx.ui.notify(
					`Safety review self-test result\nModel: ${selectedLabel}\nRequest time: ${Date.now() - startedMs} ms\nRequest:\n${command}\nOutput:\n${REVIEW_FAILED_REASON}`,
					"error",
				);
			}
		},
	});

	pi.on("tool_call", async (event, ctx: ExtensionCtx) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		const command = String(event.input.command ?? "");
		if (productionMode) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Production mode requires confirmation, but no UI is available." };
			}
			const label = "Production command confirmation";
			emitBlockedChange(pi, true, label);
			try {
				const allowed = await confirmProductionCommand(ctx, command);
				if (allowed) return undefined;
				ctx.abort();
				return {
					block: true,
					reason: "Production mode command was not approved by the user.",
					terminate: true,
				};
			} catch {
				return { block: true, reason: "Production mode confirmation failed; request declined." };
			} finally {
				emitBlockedChange(pi, false, label);
			}
		}
		if (!reviewModel) reviewModel = await loadModel();
		return reviewRequest(
			command,
			reviewModel,
			ctx,
			review,
			{
				showDebug,
				onAutoApproved: () => pi.appendEntry("safety-review-auto-approved"),
				onBlockedChange: (active, label) => emitBlockedChange(pi, active, label),
			},
		);
	});
}
