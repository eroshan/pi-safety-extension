import { parseBool, parseIntEnv } from "./util/env.js";

export interface EnvSafetyConfig {
	enabled: boolean;
	allowWithoutUI: boolean;
	allowOnReviewFailure: boolean;
	blockCriticalCommands: boolean;
	autoAllowWhitelist: boolean;
	showAutoApprovedVerdict: boolean;
	/**
	 * Minimum time (ms) the progress indicator stays in its final (decision) state
	 * before it resets back to idle.
	 */
	progressFinalHoldMs: number;
	cache: {
		enabled: boolean;
		backend: "memory" | "sqlite";
		maxEntries: number;
		sqlitePath: string;
	};
	logging: {
		bashAuditEnabled: boolean;
		cacheMirrorEnabled: boolean;
		debugEnabled: boolean;
	};
}

// A config shape that can be stored in state/config.json.
// It intentionally mirrors EnvSafetyConfig but everything is optional.
export interface SafetyConfigFile {
	enabled?: boolean;
	allowWithoutUI?: boolean;
	allowOnReviewFailure?: boolean;
	blockCriticalCommands?: boolean;
	autoAllowWhitelist?: boolean;
	showAutoApprovedVerdict?: boolean;
	progressFinalHoldMs?: number;
	cache?: {
		enabled?: boolean;
		backend?: "memory" | "sqlite";
		maxEntries?: number;
		sqlitePath?: string;
	};
	logging?: {
		bashAuditEnabled?: boolean;
		cacheMirrorEnabled?: boolean;
		debugEnabled?: boolean;
	};
}

/**
 * Returns the effective runtime config.
 *
 * Priority:
 * 1) Environment variables (if set)
 * 2) Values from state/config.json (passed as `fileCfg`)
 * 3) Built-in defaults
 */
export function getEnvConfig(fileCfg?: SafetyConfigFile): EnvSafetyConfig {
	const defaults: EnvSafetyConfig = {
		enabled: true,
		allowWithoutUI: false,
		allowOnReviewFailure: false,
		blockCriticalCommands: true,
		autoAllowWhitelist: true,
		showAutoApprovedVerdict: false,
		progressFinalHoldMs: 2000,
		cache: {
			enabled: true,
			backend: "memory",
			maxEntries: 2000,
			sqlitePath: "state/cache.sqlite3",
		},
		logging: {
			bashAuditEnabled: true,
			cacheMirrorEnabled: false,
			debugEnabled: false,
		},
	};

	const f = fileCfg ?? {};

	const envIsSet = (k: string) => process.env[k] !== undefined;

	const enabled = envIsSet("SAFETY_ENABLED")
		? parseBool(process.env.SAFETY_ENABLED, defaults.enabled)
		: (f.enabled ?? defaults.enabled);
	const allowWithoutUI = envIsSet("SAFETY_ALLOW_WITHOUT_UI")
		? parseBool(process.env.SAFETY_ALLOW_WITHOUT_UI, defaults.allowWithoutUI)
		: (f.allowWithoutUI ?? defaults.allowWithoutUI);
	const allowOnReviewFailure = envIsSet("SAFETY_ALLOW_ON_REVIEW_FAILURE")
		? parseBool(process.env.SAFETY_ALLOW_ON_REVIEW_FAILURE, defaults.allowOnReviewFailure)
		: (f.allowOnReviewFailure ?? defaults.allowOnReviewFailure);
	const blockCriticalCommands = envIsSet("SAFETY_BLOCK_CRITICAL_COMMANDS")
		? parseBool(process.env.SAFETY_BLOCK_CRITICAL_COMMANDS, defaults.blockCriticalCommands)
		: (f.blockCriticalCommands ?? defaults.blockCriticalCommands);
	const autoAllowWhitelist = envIsSet("SAFETY_AUTO_ALLOW_WHITELIST")
		? parseBool(process.env.SAFETY_AUTO_ALLOW_WHITELIST, defaults.autoAllowWhitelist)
		: (f.autoAllowWhitelist ?? defaults.autoAllowWhitelist);
	const showAutoApprovedVerdict = envIsSet("SAFETY_SHOW_AUTOAPPROVED_VERDICT")
		? parseBool(process.env.SAFETY_SHOW_AUTOAPPROVED_VERDICT, defaults.showAutoApprovedVerdict)
		: (f.showAutoApprovedVerdict ?? defaults.showAutoApprovedVerdict);
	const progressFinalHoldMsRaw = envIsSet("SAFETY_PROGRESS_FINAL_HOLD_MS")
		? parseIntEnv(process.env.SAFETY_PROGRESS_FINAL_HOLD_MS, defaults.progressFinalHoldMs)
		: (f.progressFinalHoldMs ?? defaults.progressFinalHoldMs);
	const progressFinalHoldMs = Math.max(0, progressFinalHoldMsRaw);

	const cacheEnabled = envIsSet("SAFETY_CACHE_ENABLED")
		? parseBool(process.env.SAFETY_CACHE_ENABLED, defaults.cache.enabled)
		: (f.cache?.enabled ?? defaults.cache.enabled);
	const cacheBackend = envIsSet("SAFETY_CACHE_BACKEND")
		? (process.env.SAFETY_CACHE_BACKEND?.trim().toLowerCase() === "sqlite" ? "sqlite" : "memory")
		: (f.cache?.backend ?? defaults.cache.backend);
	const cacheMaxEntries = envIsSet("SAFETY_CACHE_MAX_ENTRIES")
		? parseIntEnv(process.env.SAFETY_CACHE_MAX_ENTRIES, defaults.cache.maxEntries)
		: (f.cache?.maxEntries ?? defaults.cache.maxEntries);
	const sqlitePath = envIsSet("SAFETY_SQLITE_CACHE_PATH")
		? (process.env.SAFETY_SQLITE_CACHE_PATH?.trim() || defaults.cache.sqlitePath)
		: (f.cache?.sqlitePath ?? defaults.cache.sqlitePath);

	const bashAuditEnabled = envIsSet("SAFETY_BASH_AUDIT_ENABLED")
		? parseBool(process.env.SAFETY_BASH_AUDIT_ENABLED, defaults.logging.bashAuditEnabled)
		: (f.logging?.bashAuditEnabled ?? defaults.logging.bashAuditEnabled);
	const cacheMirrorEnabled = envIsSet("SAFETY_CACHE_MIRROR_ENABLED")
		? parseBool(process.env.SAFETY_CACHE_MIRROR_ENABLED, defaults.logging.cacheMirrorEnabled)
		: (f.logging?.cacheMirrorEnabled ?? defaults.logging.cacheMirrorEnabled);
	const debugEnabled = envIsSet("SAFETY_DEBUG_ENABLED")
		? parseBool(process.env.SAFETY_DEBUG_ENABLED, defaults.logging.debugEnabled)
		: (f.logging?.debugEnabled ?? defaults.logging.debugEnabled);

	return {
		enabled,
		allowWithoutUI,
		allowOnReviewFailure,
		blockCriticalCommands,
		autoAllowWhitelist,
		showAutoApprovedVerdict,
		progressFinalHoldMs,
		cache: {
			enabled: cacheEnabled,
			backend: cacheBackend,
			maxEntries: cacheMaxEntries,
			sqlitePath,
		},
		logging: {
			bashAuditEnabled,
			cacheMirrorEnabled,
			debugEnabled,
		},
	};
}
