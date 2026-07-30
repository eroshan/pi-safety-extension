import { describe, expect, test, beforeEach } from "vitest";
import { normalizeCommand } from "../src/analyze/normalize.js";

// Make HOME stable for tests that resolve ~
beforeEach(() => {
	process.env.HOME = "/home/test";
});

describe("normalizeCommand", () => {
	test("extracts leading cd segments and computes effective cwd", () => {
		const n = normalizeCommand("cd foo && ls", "/repo");
		expect(n.effectiveCwd).toBe("/repo/foo");
		expect(n.tokensAfterCd).toEqual(["ls"]);
	});

	test("normalizes paths and URLs to placeholders", () => {
		const n = normalizeCommand("cat /etc/passwd https://example.com", "/repo");
		expect(n.stableTokens).toEqual(["cat", "<path1>", "<url1>"]);
	});

	test("normalizes long hex and numbers", () => {
		const n = normalizeCommand("git show deadbeefdeadbeef 1234", "/repo");
		expect(n.stableTokens).toEqual(["git", "show", "<hex>", "<number>"]);
	});

	test("sorts simple flag runs", () => {
		const n1 = normalizeCommand("ls -z -a -l", "/repo");
		const n2 = normalizeCommand("ls -l -a -z", "/repo");
		expect(n1.stableCommand).toBe(n2.stableCommand);
		expect(n1.stableTokens).toEqual(["ls", "-a", "-l", "-z"]);
	});

	test("cache keys stable for equivalent commands", () => {
		const a = normalizeCommand("ls -l -a", "/repo");
		const b = normalizeCommand("ls -a -l", "/repo");
		expect(a.baseKey).toBe(b.baseKey);
	});

	test("fingerprint key includes path fingerprint suffix", () => {
		const a = normalizeCommand("cat /a", "/repo");
		const b = normalizeCommand("cat /b", "/repo");
		// baseKey should be same (both normalize to <path1>), fingerprintKey should differ
		expect(a.baseKey).toBe(b.baseKey);
		expect(a.fingerprintKey).not.toBe(b.fingerprintKey);
	});
});
