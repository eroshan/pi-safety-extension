import { describe, expect, test } from "vitest";
import { resolveStatePath } from "../src/state.js";
import { makeState } from "./helpers/state.js";

describe("resolveStatePath", () => {
	test("relative paths resolve inside extensionDir", () => {
		const state = makeState("/ext");
		expect(resolveStatePath(state, "state/cache.sqlite3")).toBe("/ext/state/cache.sqlite3");
	});

	test("absolute paths outside extensionDir are remapped into stateDir", () => {
		const state = makeState("/ext");
		const p = resolveStatePath(state, "/tmp/outside.sqlite3");
		expect(p).toBe("/ext/state/outside.sqlite3");
	});

	test("absolute paths inside extensionDir are preserved", () => {
		const state = makeState("/ext");
		const p = resolveStatePath(state, "/ext/state/cache.sqlite3");
		expect(p).toBe("/ext/state/cache.sqlite3");
	});
});
