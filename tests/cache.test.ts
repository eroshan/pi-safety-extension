import { describe, expect, test } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

import type { EnvSafetyConfig } from "../src/config.js";
import { createMemoryCache } from "../src/cache/memory.js";
import { createSqliteCache } from "../src/cache/sqlite.js";
import { makeState } from "./helpers/state.js";

const verdict = {
	risk: "low",
	reason: "ok",
	dependsOnPaths: false,
	recommendedAction: "allow",
} as const;

describe("memory cache", () => {
	test("stores and retrieves", async () => {
		const cache = createMemoryCache(100);
		await cache.set("k", verdict);
		expect(await cache.get("k")).toEqual(verdict);
	});

	test("prunes oldest entries", async () => {
		const cache = createMemoryCache(2);
		await cache.set("k1", verdict);
		await new Promise((r) => setTimeout(r, 2));
		await cache.set("k2", verdict);
		await new Promise((r) => setTimeout(r, 2));
		await cache.set("k3", verdict);
		expect(await cache.get("k1")).toBeUndefined();
		expect(await cache.get("k2")).toEqual(verdict);
		expect(await cache.get("k3")).toEqual(verdict);
	});
});

describe("sqlite cache", () => {
	test("falls back to memory when better-sqlite3 is missing", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "safety-ext-test-"));
		const state = makeState(root);
		fs.mkdirSync(state.logsDir, { recursive: true });

		const cfg: EnvSafetyConfig = {
			enabled: true,
			allowWithoutUI: false,
			allowOnReviewFailure: false,
			blockCriticalCommands: true,
			autoAllowWhitelist: true,
			showAutoApprovedVerdict: false,
			progressFinalHoldMs: 2000,
			cache: { enabled: true, backend: "sqlite", maxEntries: 100, sqlitePath: "state/cache.sqlite3" },
			logging: { bashAuditEnabled: false, cacheMirrorEnabled: false, debugEnabled: true },
		};

		const debug = { log: () => {} };
		const cache = createSqliteCache(state, cfg, debug);

		await cache.set("k", verdict);
		expect(await cache.get("k")).toEqual(verdict);
	});
});
