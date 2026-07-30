import { describe, expect, test } from "vitest";
import { tokenizeShell } from "../src/analyze/tokenize.js";

describe("tokenizeShell", () => {
	test("splits on whitespace", () => {
		expect(tokenizeShell("ls -la").tokens).toEqual(["ls", "-la"]);
	});

	test("preserves single quotes", () => {
		expect(tokenizeShell("echo 'a b'").tokens).toEqual(["echo", "a b"]);
	});

	test("preserves double quotes and backslash escapes", () => {
		expect(tokenizeShell('echo "a b"').tokens).toEqual(["echo", "a b"]);
		expect(tokenizeShell("echo a\\ b").tokens).toEqual(["echo", "a b"]);
	});

	test("extracts operators as tokens", () => {
		expect(tokenizeShell("cd x && ls").tokens).toEqual(["cd", "x", "&&", "ls"]);
		expect(tokenizeShell("echo hi|wc").tokens).toEqual(["echo", "hi", "|", "wc"]);
	});
});
