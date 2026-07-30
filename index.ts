import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import { getEnvConfig } from "./src/config.js";
import { ensureStateLayout, loadExtensionConfig, saveExtensionConfig } from "./src/state.js";
import type { ExtensionConfigFile } from "./src/state.js";
import { createAuditLogger } from "./src/logging/audit.js";
import { createDebugLogger } from "./src/logging/debug.js";
import { createCacheMirrorLogger } from "./src/logging/cache-mirror.js";
import { hasAdvancedShellSyntax } from "./src/analyze/advanced-syntax.js";
import { normalizeCommand } from "./src/analyze/normalize.js";
import { isAutoAllowWhitelisted } from "./src/analyze/safe-commands.js";
import { createMemoryCache } from "./src/cache/memory.js";
import { createSqliteCache } from "./src/cache/sqlite.js";
import type { SafetyCache } from "./src/cache/interface.js";
import { dedupe } from "./src/review/dedupe.js";
import { reviewBashCommand } from "./src/review/safety-review.js";
import { validateSafetyVerdictStrict, type SafetyVerdict } from "./src/review/verdict.js";
import { emitApprovalNotificationEvent } from "./src/ui/approval-event.js";
import { emitHerdrBlockedEvent } from "./src/ui/blocked-event.js";

type ReviewModelRef = { provider: string; id: string };

type AvailableModel = Model<Api> & {
	// pi model entries usually contain a human readable name (optional)
	name?: string;
};

type PiNotifyLevel = "info" | "warning" | "error";

type PiUI = {
	select: (title: string, options: string[]) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	notify: (message: string, level: PiNotifyLevel) => void;
	setStatus: (key: string, value: string | undefined) => void;
};

type ModelRegistryLike = {
	getAvailable: () => Promise<AvailableModel[]> | AvailableModel[];
	getApiKeyAndHeaders: (model: Model<Api>) => Promise<
		| { ok: true; apiKey?: string; headers?: Record<string, string> }
		| { ok: false; error: string }
	>;
};

type ExtensionCtx = {
	hasUI: boolean;
	cwd: string;
	ui: PiUI;
	modelRegistry: ModelRegistryLike;
};

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

// Progress indicator state
type ReviewProgress = "idle" | "request" | "response" | "decision";
type ReviewOutcome = "idle" | "in-progress" | "whitelisted" | "low-risk" | "medium-risk" | "high-risk" | "error";

// ANSI color codes
const colors = {
	blue: "\x1b[34m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

function formatProgressIndicator(progress: ReviewProgress, outcome: ReviewOutcome = "in-progress"): string {
	const filled = "■";
	const empty = "□";
	const dash = "-";
	
	// Choose color based on outcome
	let color = colors.dim;
	if (outcome === "whitelisted") color = colors.blue;
	else if (outcome === "low-risk") color = colors.green;
	else if (outcome === "medium-risk") color = colors.yellow;
	else if (outcome === "high-risk") color = colors.red;
	else if (outcome === "error") color = colors.red;
	
	let content: string;
	if (outcome === "error") {
		content = `${dash} ${dash} ${dash}`;
	} else {
		switch (progress) {
			case "idle":
				content = `${empty} ${empty} ${empty}`;
				break;
			case "request":
				content = `${filled} ${empty} ${empty}`;
				break;
			case "response":
				content = `${filled} ${filled} ${empty}`;
				break;
			case "decision":
				content = `${filled} ${filled} ${filled}`;
				break;
		}
	}
	
	return `[ SR: ${color}${content}${colors.reset} ]`;
}

function updateReviewProgress(
	ctx: Pick<ExtensionCtx, "hasUI" | "ui">,
	progress: ReviewProgress,
	outcome: ReviewOutcome = "in-progress",
) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("safety-review", formatProgressIndicator(progress, outcome));
}

function clearReviewProgress(ctx: Pick<ExtensionCtx, "hasUI" | "ui">) {
	if (!ctx.hasUI) return;
	// Return to idle state instead of clearing completely
	ctx.ui.setStatus("safety-review", formatProgressIndicator("idle", "idle"));
}

export default function safetyExtension(pi: ExtensionAPI) {
	let cache: SafetyCache | undefined;
	let reviewModel: ReviewModelRef | undefined;
	let fileCfg: ExtensionConfigFile = {};
	let modelSetupPromise: Promise<ReviewModelRef | undefined> | null = null;
	let modelSetupPromptedThisSession = false;

	// Lazily initialized paths + loggers
	const state = ensureStateLayout();
	const debug = createDebugLogger(state);
	const audit = createAuditLogger(state);
	const cacheMirror = createCacheMirrorLogger(state);

	// Progress indicator control: ensure the final (decision) state stays visible for
	// a minimum duration, while allowing the *latest bash tool call* to reset immediately.
	let latestBashToolCallReviewId = 0;
	let progressClearTimeout: ReturnType<typeof setTimeout> | undefined;

	function cancelProgressClear() {
		if (progressClearTimeout) clearTimeout(progressClearTimeout);
		progressClearTimeout = undefined;
	}

	function startBashToolCallReview(ctx: Pick<ExtensionCtx, "hasUI" | "ui">): number {
		latestBashToolCallReviewId += 1;
		cancelProgressClear();
		updateReviewProgress(ctx, "request");
		return latestBashToolCallReviewId;
	}

	function setBashToolCallReviewProgressIfLatest(
		ctx: Pick<ExtensionCtx, "hasUI" | "ui">,
		reviewId: number,
		progress: ReviewProgress,
		outcome: ReviewOutcome = "in-progress",
	) {
		if (reviewId !== latestBashToolCallReviewId) return;
		updateReviewProgress(ctx, progress, outcome);
	}

	function finalizeBashToolCallReviewProgressIfLatest(
		ctx: Pick<ExtensionCtx, "hasUI" | "ui">,
		reviewId: number,
		outcome: ReviewOutcome,
		holdMs: number,
	) {
		if (reviewId !== latestBashToolCallReviewId) return;
		cancelProgressClear();
		updateReviewProgress(ctx, "decision", outcome);
		const ms = Math.max(0, holdMs);
		progressClearTimeout = setTimeout(() => {
			if (reviewId !== latestBashToolCallReviewId) return;
			clearReviewProgress(ctx);
			progressClearTimeout = undefined;
		}, ms);
	}

	async function ensureReviewModelConfigured(
		ctx: ExtensionCtx,
		opts?: { force?: boolean },
	): Promise<ReviewModelRef | undefined> {
		// Reuse any in-flight setup to avoid multiple dialogs.
		if (modelSetupPromise && !opts?.force) return modelSetupPromise;

		const extCfg = await loadExtensionConfig(state, debug);
		fileCfg = extCfg;
		reviewModel = extCfg.reviewModel ?? reviewModel;

		if (reviewModel && !opts?.force) return reviewModel;

		if (!ctx.hasUI) return undefined;

		modelSetupPromise = (async () => {
			try {
				const available = await Promise.resolve(ctx.modelRegistry.getAvailable());
				if (!available || available.length === 0) return undefined;

				const sorted = [...available].sort((a, b) => {
					const score = (m: AvailableModel) => {
						const id = `${m.provider}/${m.id}`.toLowerCase();
						const name = String(m.name ?? "").toLowerCase();
						// Prefer Claude Haiku (any provider, e.g. GitHub Copilot)
						if (id.includes("haiku") || name.includes("haiku")) return 0;
						return 1;
					};
					return score(a) - score(b);
				});

				const options = sorted.map((m) => `${m.provider}/${m.id} — ${String(m.name ?? "")}`);
				const selected = await ctx.ui.select(
					"Safety extension: select a review model (cheap is recommended)",
					options,
				);
				if (!selected) return undefined;

				const idx = options.indexOf(selected);
				if (idx < 0) return undefined;

				reviewModel = { provider: sorted[idx].provider, id: sorted[idx].id };
				await saveExtensionConfig(state, { reviewModel }, debug);
				fileCfg = { ...fileCfg, reviewModel };
				ctx.ui.notify(
					`Safety extension: selected review model ${reviewModel.provider}/${reviewModel.id}`,
					"info",
				);
				return reviewModel;
			} catch (e: unknown) {
				debug.log("model_select_failed", { error: errorMessage(e) });
				return undefined;
			} finally {
				modelSetupPromise = null;
			}
		})();

		return modelSetupPromise;
	}

	function ensureCacheInitialized() {
		if (cache) return;
		const cfg = getEnvConfig(fileCfg);
		if (!cfg.cache.enabled) return;

		if (cfg.cache.backend === "sqlite") {
			cache = createSqliteCache(state, cfg, debug);
		} else {
			cache = createMemoryCache(cfg.cache.maxEntries);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		// NOTE: We intentionally do NOT open blocking dialogs in session_start.
		// Some terminals/modes can behave oddly if a select dialog appears during initial startup.
		// We instead prompt on the first user turn (before_agent_start) or on first bash tool usage.
		modelSetupPromptedThisSession = false;
		await loadExtensionConfig(state, debug).then((c) => {
			fileCfg = c;
			reviewModel = c.reviewModel ?? reviewModel;
		});
		ensureCacheInitialized();

		cancelProgressClear();
		clearReviewProgress(ctx);
	});

	pi.on("before_agent_start", async (_event, ctx: ExtensionCtx) => {
		if (!ctx.hasUI) return;
		if (modelSetupPromptedThisSession) return;
		if (reviewModel) return;
		modelSetupPromptedThisSession = true;
		await ensureReviewModelConfigured(ctx);
	});

	pi.registerCommand("safety-setup", {
		description: "Configure/choose the safety review model",
		handler: async (_args, ctx: ExtensionCtx) => {
			const m = await ensureReviewModelConfigured(ctx, { force: true });
			if (!m && ctx.hasUI) {
				ctx.ui.notify("Safety extension: no model selected.", "warning");
			}
		},
	});

	pi.registerCommand("safety-selftest", {
		description: "Run safety verdict schema validation self-test",
		handler: async (_args, ctx: ExtensionCtx) => {
			const cases: Array<{ name: string; input: unknown; ok: boolean }> = [
				{
					name: "valid verdict",
					ok: true,
					input: {
						risk: "low",
						reason: "ok",
						dependsOnPaths: false,
						recommendedAction: "allow",
					},
				},
				{
					name: "extra key rejected",
					ok: false,
					input: {
						risk: "low",
						reason: "ok",
						dependsOnPaths: false,
						recommendedAction: "allow",
						extra: 1,
					},
				},
				{
					name: "too long reason rejected",
					ok: false,
					input: {
						risk: "low",
						reason: "x".repeat(501),
						dependsOnPaths: false,
						recommendedAction: "allow",
					},
				},
			];

			const results = cases.map((c) => {
				const v = validateSafetyVerdictStrict(c.input);
				const pass = v.ok === c.ok;
				return { name: c.name, expectedOk: c.ok, gotOk: v.ok, pass, errors: v.ok ? [] : v.errors };
			});

			debug.log("safety_selftest", { results });

			const failed = results.filter((r) => !r.pass);
			const msg =
				failed.length === 0
					? `Safety self-test: OK (${results.length}/${results.length})`
					: `Safety self-test: FAILED (${results.length - failed.length}/${results.length})\n` +
						failed.map((f) => `- ${f.name}: expected ok=${f.expectedOk}, got ok=${f.gotOk}`).join("\n");

			if (ctx.hasUI) ctx.ui.notify(msg, failed.length === 0 ? "info" : "error");
		},
	});

	function notifyAutoApproved(
		ctx: Pick<ExtensionCtx, "hasUI" | "ui">,
		cfg: ReturnType<typeof getEnvConfig>,
		info: { risk: string; source: string; reason: string; rawCommand: string },
	) {
		if (!cfg.showAutoApprovedVerdict) return;
		if (!ctx.hasUI) return;
		ctx.ui.notify(
			`Safety auto-approved (${info.risk}, ${info.source})\n${info.rawCommand}\nReason: ${info.reason}`,
			"info",
		);
	}

	function emitApprovalRequiredNotification(info: { risk: string; reason: string; rawCommand: string }) {
		try {
			emitApprovalNotificationEvent(pi.events, info);
		} catch (e: unknown) {
			debug.log("approval_notification_emit_failed", { error: errorMessage(e) });
		}
	}

	function emitHerdrBlockedState(info: { active: boolean; label?: string }) {
		try {
			emitHerdrBlockedEvent(pi.events, info);
		} catch (e: unknown) {
			debug.log("herdr_blocked_emit_failed", { error: errorMessage(e), active: info.active, label: info.label });
		}
	}

	pi.on("tool_call", async (event, ctx: ExtensionCtx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const cfg = getEnvConfig(fileCfg);
		if (!cfg.enabled) return undefined;

		ensureCacheInitialized();

		const reviewId = startBashToolCallReview(ctx);

		const rawCommand = String(event.input.command ?? "");
		const advancedSyntax = hasAdvancedShellSyntax(rawCommand);
		const normalized = normalizeCommand(rawCommand, ctx.cwd);

		const auditBase = {
			rawCommand,
			effectiveCwd: normalized.effectiveCwd,
			normalizedCommand: normalized.stableCommand,
			advancedSyntax,
			baseKey: normalized.baseKey,
			fingerprintKey: normalized.fingerprintKey,
		};

		// Auto-allow conservative whitelist (only if no advanced syntax)
		if (cfg.autoAllowWhitelist && !advancedSyntax && isAutoAllowWhitelisted(normalized.tokensAfterCd)) {
			audit.log({
				...auditBase,
				decision: "allow",
				source: "whitelist",
				verdict: { risk: "low", reason: "whitelisted", dependsOnPaths: false, recommendedAction: "allow" },
			});
			notifyAutoApproved(ctx, cfg, {
				risk: "low",
				source: "whitelist",
				reason: "whitelisted",
				rawCommand,
			});
			
			finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "whitelisted", cfg.progressFinalHoldMs);

			return undefined;
		}

		// Cache lookup
		let cached: SafetyVerdict | undefined;
		if (cfg.cache.enabled && cache) {
			cached = (await cache.get(normalized.fingerprintKey)) ?? (await cache.get(normalized.baseKey));
			if (cached) {
				audit.log({ ...auditBase, decision: "cache_hit", source: "cache", cached: true, verdict: cached });
				
				// Show cache hit - jump straight to response phase with appropriate color
				const cachedRiskOutcome: ReviewOutcome = 
					cached.risk === "critical" || cached.risk === "high" ? "high-risk" :
					cached.risk === "medium" ? "medium-risk" :
					"low-risk";
				setBashToolCallReviewProgressIfLatest(ctx, reviewId, "response", cachedRiskOutcome);
			}
		}

		let verdict = cached;

		if (!verdict) {
			const selected = await ensureReviewModelConfigured(ctx);
			if (!selected) {
				const reason =
					"Safety extension: no review model configured/available. Run pi in interactive mode once to select a model.";
				audit.log({
					...auditBase,
					decision: "block",
					source: "no_model",
					verdict: { risk: "critical", reason, dependsOnPaths: false, recommendedAction: "block" },
				});
				finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "error", cfg.progressFinalHoldMs);
				return { block: true, reason };
			}

			// Resolve Model object from registry each time (ensures availability)
			const available = await Promise.resolve(ctx.modelRegistry.getAvailable());
			const model = available.find((m) => m.provider === selected.provider && m.id === selected.id);
			if (!model) {
				const reason = `Safety extension: configured review model ${selected.provider}/${selected.id} is not available (missing API key?).`;
				audit.log({
					...auditBase,
					decision: "block",
					source: "model_unavailable",
					verdict: { risk: "critical", reason, dependsOnPaths: false, recommendedAction: "block" },
				});
				finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "error", cfg.progressFinalHoldMs);
				return { block: true, reason };
			}

			setBashToolCallReviewProgressIfLatest(ctx, reviewId, "request");

			try {
				verdict = await dedupe(normalized.fingerprintKey, () =>
					reviewBashCommand({
						model,
						ctx,
						rawCommand,
						normalized,
						advancedSyntax,
						debug,
					}),
				);

				setBashToolCallReviewProgressIfLatest(ctx, reviewId, "response");
			} catch (e: unknown) {
				const msg = errorMessage(e);
				debug.log("review_failed", { error: msg });
				
				finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "error", cfg.progressFinalHoldMs);

				if (!cfg.allowOnReviewFailure) {
					const reason = `Safety extension: safety review failed: ${msg}`;
					audit.log({
						...auditBase,
						decision: "block",
						source: "review_failed",
						verdict: { risk: "high", reason, dependsOnPaths: false, recommendedAction: "block" },
					});
					return { block: true, reason };
				}

				audit.log({
					...auditBase,
					decision: "allow",
					source: "review_failed_allow",
					verdict: {
						risk: "high",
						reason: `Safety review failed but SAFETY_ALLOW_ON_REVIEW_FAILURE=true: ${msg}`,
						dependsOnPaths: false,
						recommendedAction: "allow",
					},
				});
				notifyAutoApproved(ctx, cfg, {
					risk: "high",
					source: "review_failed_allow",
					reason: `review failed: ${msg}`,
					rawCommand,
				});
				return undefined;
			}

			// Cache store
			if (cfg.cache.enabled && cache) {
				const key = verdict.dependsOnPaths ? normalized.fingerprintKey : normalized.baseKey;
				await cache.set(key, verdict);
				if (cfg.logging.cacheMirrorEnabled) {
					cacheMirror.log({ key, verdict });
				}
			}
		}

		// Policy application
		const risk = verdict?.risk ?? "high";
		const action = verdict?.recommendedAction ?? (risk === "low" ? "allow" : "confirm");
		const reasonText = verdict?.reason ?? "No reason provided";

		// Determine outcome color based on risk
		const riskOutcome: ReviewOutcome = 
			risk === "critical" ? "high-risk" :
			risk === "high" ? "high-risk" :
			risk === "medium" ? "medium-risk" :
			"low-risk";

		if (risk === "critical" && cfg.blockCriticalCommands) {
			const reason = `Blocked critical command: ${reasonText}`;
			audit.log({ ...auditBase, decision: "block", source: "policy", decisionDetail: reason, verdict });
			
			finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "high-risk", cfg.progressFinalHoldMs);
			
			return { block: true, reason };
		}

		if (action === "block") {
			const reason = `Blocked by safety review: ${reasonText}`;
			audit.log({ ...auditBase, decision: "block", source: "policy", decisionDetail: reason, verdict });
			
			finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, riskOutcome, cfg.progressFinalHoldMs);
			
			return { block: true, reason };
		}

		const requiresConfirm = action === "confirm" || risk === "medium" || risk === "high" || risk === "critical";
		if (requiresConfirm) {
			if (!ctx.hasUI) {
				if (cfg.allowWithoutUI) {
					audit.log({
						...auditBase,
						decision: "allow",
						source: "no_ui_allow",
						decisionDetail: "Confirmation required but SAFETY_ALLOW_WITHOUT_UI=true",
						verdict,
					});
					
					finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, riskOutcome, cfg.progressFinalHoldMs);
					
					return undefined;
				}
				const reason = `Blocked (no UI available for confirmation). Safety review: ${reasonText}`;
				audit.log({ ...auditBase, decision: "block", source: "no_ui_block", decisionDetail: reason, verdict });
				
				finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, riskOutcome, cfg.progressFinalHoldMs);
				
				return { block: true, reason };
			}

			emitApprovalRequiredNotification({
				risk,
				reason: reasonText,
				rawCommand,
			});
			emitHerdrBlockedState({ active: true, label: `Safety approval required (${risk})` });

			let ok: boolean;
			try {
				ok = await ctx.ui.confirm(
					`Safety check (${risk})`,
					`Command:\n\n  ${rawCommand}\n\nReview reason:\n\n  ${reasonText}\n\nAllow execution?`,
				);
			} finally {
				emitHerdrBlockedState({ active: false });
			}

			finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, riskOutcome, cfg.progressFinalHoldMs);

			if (!ok) {
				const reason = "Blocked by user (safety confirmation declined)";
				audit.log({ ...auditBase, decision: "block", source: "user", decisionDetail: reason, verdict });
				return { block: true, reason };
			}

			audit.log({ ...auditBase, decision: "allow", source: "user", decisionDetail: "Confirmed by user", verdict });
			return undefined;
		}

		// allow (auto-approved)
		const source = cached ? "cache" : "review";
		audit.log({ ...auditBase, decision: "allow", source, verdict });
		notifyAutoApproved(ctx, cfg, { risk, source, reason: reasonText, rawCommand });
		
		finalizeBashToolCallReviewProgressIfLatest(ctx, reviewId, "low-risk", cfg.progressFinalHoldMs);

		return undefined;
	});
}
