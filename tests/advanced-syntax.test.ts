import { describe, expect, test } from "vitest";
import { hasAdvancedShellSyntax } from "../src/analyze/advanced-syntax.js";

describe("hasAdvancedShellSyntax", () => {
	test("false for simple commands", () => {
		expect(hasAdvancedShellSyntax("ls -la")).toBe(false);
		expect(hasAdvancedShellSyntax("git status")).toBe(false);
	});

	test("true for pipes/redirects/chaining/subshell", () => {
		expect(hasAdvancedShellSyntax("echo hi | wc -c")).toBe(true);
		expect(hasAdvancedShellSyntax("cat a > b")).toBe(true);
		expect(hasAdvancedShellSyntax("cd x && ls")).toBe(true);
		expect(hasAdvancedShellSyntax("echo $(date)")).toBe(true);
		expect(hasAdvancedShellSyntax("echo `date`")).toBe(true);
		expect(hasAdvancedShellSyntax("(cd x; ls)")).toBe(true);
	});
});
