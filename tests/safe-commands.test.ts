import { describe, expect, test } from "vitest";
import { isAutoAllowWhitelisted } from "../src/analyze/safe-commands.js";
import { tokenizeShell } from "../src/analyze/tokenize.js";

describe("isAutoAllowWhitelisted", () => {
	function t(cmd: string) {
		return tokenizeShell(cmd).tokens;
	}

	test("allows basics", () => {
		expect(isAutoAllowWhitelisted(t("pwd"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("whoami"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("date"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("ls -la"))).toBe(true);
	});

	test("allows limited git commands", () => {
		expect(isAutoAllowWhitelisted(t("git status"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git status --short"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git diff"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git branch"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git rev-parse --show-toplevel"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git rev-parse --is-inside-work-tree"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("git log -n 10"))).toBe(true);
	});

	test("blocks git log without -n", () => {
		expect(isAutoAllowWhitelisted(t("git log"))).toBe(false);
	});

	test("allows read-only file commands", () => {
		expect(isAutoAllowWhitelisted(t("cat README.md"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("head -20 main.go"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("tail -20 main.go"))).toBe(true);
	});

	test("allows search commands", () => {
		expect(isAutoAllowWhitelisted(t("rg -n something src/"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("grep -r pattern ."))).toBe(true);
	});

	test("allows safe find", () => {
		expect(isAutoAllowWhitelisted(t("find . -type f -maxdepth 3"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("find tests -type f"))).toBe(true);
	});

	test("blocks dangerous find", () => {
		expect(isAutoAllowWhitelisted(t("find . -exec rm {} ;"))).toBe(false);
		expect(isAutoAllowWhitelisted(t("find . -delete"))).toBe(false);
	});

	test("allows go toolchain", () => {
		expect(isAutoAllowWhitelisted(t("go test ./..."))).toBe(true);
		expect(isAutoAllowWhitelisted(t("go test ./luastate/..."))).toBe(true);
		expect(isAutoAllowWhitelisted(t("go build ./..."))).toBe(true);
		expect(isAutoAllowWhitelisted(t("go vet ./..."))).toBe(true);
		expect(isAutoAllowWhitelisted(t("go version"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("gofmt -d ."))).toBe(true);
		expect(isAutoAllowWhitelisted(t("gofmt -l ."))).toBe(true);
	});

	test("blocks mutating gofmt", () => {
		expect(isAutoAllowWhitelisted(t("gofmt -w ."))).toBe(false);
		expect(isAutoAllowWhitelisted(t("gofmt -w -d ."))).toBe(false);
	});

	test("allows safe npm commands", () => {
		expect(isAutoAllowWhitelisted(t("npm test"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("npm run lint"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("npm run typecheck"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("npm run build"))).toBe(true);
	});

	test("blocks npm install and publish", () => {
		expect(isAutoAllowWhitelisted(t("npm install"))).toBe(false);
		expect(isAutoAllowWhitelisted(t("npm publish"))).toBe(false);
		expect(isAutoAllowWhitelisted(t("npm run deploy"))).toBe(false);
	});

	test("allows npx tsc --noEmit", () => {
		expect(isAutoAllowWhitelisted(t("npx tsc --noEmit"))).toBe(true);
		expect(isAutoAllowWhitelisted(t("npx tsc -p tsconfig.json --noEmit"))).toBe(true);
	});

	test("blocks npx tsc without --noEmit", () => {
		expect(isAutoAllowWhitelisted(t("npx tsc"))).toBe(false);
		expect(isAutoAllowWhitelisted(t("npx tsc -p tsconfig.json"))).toBe(false);
	});

	test("blocks obviously unsafe commands", () => {
		expect(isAutoAllowWhitelisted(t("rm -rf /"))).toBe(false);
		expect(isAutoAllowWhitelisted(t("curl https://evil"))).toBe(false);
	});
});
