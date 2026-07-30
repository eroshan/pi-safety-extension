import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { getEnvConfig } from "../src/config.js";

const snapshotEnv = () => ({ ...process.env });

function restoreEnv(prev: Record<string, string | undefined>) {
	for (const k of Object.keys(process.env)) {
		if (!(k in prev)) delete process.env[k];
	}
	for (const [k, v] of Object.entries(prev)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
}

describe("getEnvConfig", () => {
	let env0: Record<string, string | undefined>;

	beforeEach(() => {
		env0 = snapshotEnv();
	});
	afterEach(() => {
		restoreEnv(env0);
	});

	test("defaults", () => {
		// Ensure relevant vars are unset
		for (const k of Object.keys(process.env)) {
			if (k.startsWith("SAFETY_")) delete process.env[k];
		}
		const cfg = getEnvConfig();
		expect(cfg.enabled).toBe(true);
		expect(cfg.cache.enabled).toBe(true);
		expect(cfg.cache.backend).toBe("memory");
		expect(cfg.cache.maxEntries).toBe(2000);
		expect(cfg.showAutoApprovedVerdict).toBe(false);
		expect(cfg.progressFinalHoldMs).toBe(2000);
	});

	test("uses config.json values when env vars are not set", () => {
		for (const k of Object.keys(process.env)) {
			if (k.startsWith("SAFETY_")) delete process.env[k];
		}
		const cfg = getEnvConfig({
			enabled: false,
			progressFinalHoldMs: 123,
			cache: { backend: "sqlite", maxEntries: 10 },
		});
		expect(cfg.enabled).toBe(false);
		expect(cfg.cache.backend).toBe("sqlite");
		expect(cfg.cache.maxEntries).toBe(10);
		expect(cfg.progressFinalHoldMs).toBe(123);
	});

	test("env vars have priority over config.json", () => {
		for (const k of Object.keys(process.env)) {
			if (k.startsWith("SAFETY_")) delete process.env[k];
		}
		process.env.SAFETY_ENABLED = "true";
		process.env.SAFETY_CACHE_BACKEND = "memory";
		process.env.SAFETY_CACHE_MAX_ENTRIES = "99";
		process.env.SAFETY_PROGRESS_FINAL_HOLD_MS = "555";

		const cfg = getEnvConfig({
			enabled: false,
			progressFinalHoldMs: 123,
			cache: { backend: "sqlite", maxEntries: 10 },
		});
		expect(cfg.enabled).toBe(true);
		expect(cfg.cache.backend).toBe("memory");
		expect(cfg.cache.maxEntries).toBe(99);
		expect(cfg.progressFinalHoldMs).toBe(555);
	});

	test("parses booleans and numbers", () => {
		process.env.SAFETY_ENABLED = "false";
		process.env.SAFETY_CACHE_BACKEND = "sqlite";
		process.env.SAFETY_CACHE_MAX_ENTRIES = "10";
		process.env.SAFETY_SHOW_AUTOAPPROVED_VERDICT = "true";
		process.env.SAFETY_PROGRESS_FINAL_HOLD_MS = "2500";
		const cfg = getEnvConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.cache.backend).toBe("sqlite");
		expect(cfg.cache.maxEntries).toBe(10);
		expect(cfg.showAutoApprovedVerdict).toBe(true);
		expect(cfg.progressFinalHoldMs).toBe(2500);
	});
});
