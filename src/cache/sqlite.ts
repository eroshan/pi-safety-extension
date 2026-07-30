import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

import type { EnvSafetyConfig } from "../config.js";
import type { ExtensionStatePaths } from "../state.js";
import { resolveStatePath } from "../state.js";
import type { SafetyCache } from "./interface.js";
import type { SafetyVerdict } from "../review/verdict.js";
import { createMemoryCache } from "./memory.js";

type DebugLogger = { log: (event: string, data?: unknown) => void };

type SqliteStatement = {
	get: (...args: unknown[]) => unknown;
	run: (...args: unknown[]) => unknown;
};

type SqliteDb = {
	pragma: (s: string) => void;
	exec: (sql: string) => void;
	prepare: (sql: string) => SqliteStatement;
};

type BetterSqlite3Ctor = new (filename: string) => SqliteDb;

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Optional SQLite cache backend.
 *
 * Implementation uses `better-sqlite3` if it is installed in the extension folder.
 * If the dependency is missing or the DB can't be opened, falls back to an in-memory cache.
 */
export function createSqliteCache(state: ExtensionStatePaths, cfg: EnvSafetyConfig, debug: DebugLogger): SafetyCache {
	let db: SqliteDb | undefined;
	let disabled = false;
	const maxEntries = cfg.cache.maxEntries;
	const dbPath = resolveStatePath(state, cfg.cache.sqlitePath || "state/cache.sqlite3");
	const fallback = createMemoryCache(maxEntries);
	const require = createRequire(import.meta.url);

	const init = () => {
		if (db || disabled) return;
		try {
			// Dynamic require so dependency is optional.
			const BetterSqlite3 = require("better-sqlite3") as unknown as BetterSqlite3Ctor;
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			db = new BetterSqlite3(dbPath);
			db.pragma("journal_mode = WAL");
			db.exec(
				"CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);" +
					"CREATE INDEX IF NOT EXISTS cache_ts ON cache(ts)",
			);
		} catch (e: unknown) {
			disabled = true;
			debug.log("sqlite_cache_unavailable", {
				error: errorMessage(e),
				dbPath,
				hint: "To enable: (cd safety-extension && npm i better-sqlite3) and set SAFETY_CACHE_BACKEND=sqlite",
			});
		}
	};

	const prune = () => {
		if (!db) return;
		try {
			const row = db.prepare("SELECT COUNT(*) as c FROM cache").get();
			const count = isRecord(row) && typeof row.c === "number" ? row.c : undefined;
			if (typeof count !== "number") return;
			if (count <= maxEntries) return;

			const toDelete = count - maxEntries;
			db.prepare("DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY ts ASC LIMIT ?)").run(toDelete);
		} catch (e: unknown) {
			debug.log("sqlite_cache_prune_failed", { error: errorMessage(e) });
		}
	};

	return {
		async get(key: string) {
			init();
			if (disabled || !db) return fallback.get(key);
			try {
				const row = db.prepare("SELECT value FROM cache WHERE key=?").get(key);
				if (!isRecord(row) || typeof row.value !== "string") return undefined;
				return JSON.parse(row.value) as SafetyVerdict;
			} catch (e: unknown) {
				debug.log("sqlite_cache_get_failed", { error: errorMessage(e) });
				return fallback.get(key);
			}
		},
		async set(key: string, verdict: SafetyVerdict) {
			init();
			if (disabled || !db) return fallback.set(key, verdict);
			try {
				const ts = Date.now();
				db.prepare("INSERT OR REPLACE INTO cache(key, value, ts) VALUES (?, ?, ?)").run(
					key,
					JSON.stringify(verdict),
					ts,
				);
				prune();
			} catch (e: unknown) {
				debug.log("sqlite_cache_set_failed", { error: errorMessage(e) });
				return fallback.set(key, verdict);
			}
		},
	};
}
