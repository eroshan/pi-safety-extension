import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { SafetyConfigFile } from "./config.js";

interface ReviewModelRef {
	provider: string;
	id: string;
}

export interface ExtensionConfigFile extends SafetyConfigFile {
	reviewModel?: ReviewModelRef;
}

export interface ExtensionStatePaths {
	extensionDir: string;
	stateDir: string;
	logsDir: string;
	configPath: string;
	auditLogPath: string;
	cacheMirrorLogPath: string;
	debugLogPath: string;
	defaultSqlitePath: string;
}

type DebugLogger = { log: (event: string, data?: unknown) => void };

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function ensureStateLayout(): ExtensionStatePaths {
	// state.ts is in src/, so extension root is one level up.
	const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const stateDir = path.join(extensionDir, "state");
	const logsDir = path.join(stateDir, "logs");

	if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
	if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

	return {
		extensionDir,
		stateDir,
		logsDir,
		configPath: path.join(stateDir, "config.json"),
		auditLogPath: path.join(logsDir, "bash-audit.log"),
		cacheMirrorLogPath: path.join(logsDir, "cache-mirror.log"),
		debugLogPath: path.join(logsDir, "debug.log"),
		defaultSqlitePath: path.join(stateDir, "cache.sqlite3"),
	};
}

export async function loadExtensionConfig(state: ExtensionStatePaths, debug?: DebugLogger): Promise<ExtensionConfigFile> {
	try {
		const raw = await fsp.readFile(state.configPath, "utf8");
		return JSON.parse(raw) as ExtensionConfigFile;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException;
		if (err?.code === "ENOENT") return {};
		debug?.log("config_load_failed", { error: errorMessage(e) });
		return {};
	}
}

export async function saveExtensionConfig(
	state: ExtensionStatePaths,
	patch: ExtensionConfigFile,
	debug?: DebugLogger,
): Promise<void> {
	try {
		const current = await loadExtensionConfig(state, debug);
		const next = { ...current, ...patch } as ExtensionConfigFile;
		await fsp.writeFile(state.configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
	} catch (e: unknown) {
		debug?.log("config_save_failed", { error: errorMessage(e) });
	}
}

export function resolveStatePath(state: ExtensionStatePaths, p: string): string {
	// Enforce the extension constraint: state must live inside the extension folder.
	// - Relative paths are resolved against extensionDir.
	// - Absolute paths are only accepted if they are within extensionDir; otherwise they are re-mapped into stateDir.
	if (path.isAbsolute(p)) {
		const normalized = path.normalize(p);
		const base = path.normalize(state.extensionDir + path.sep);
		if (normalized.startsWith(base)) return normalized;
		return path.join(state.stateDir, path.basename(normalized));
	}
	return path.resolve(state.extensionDir, p);
}
