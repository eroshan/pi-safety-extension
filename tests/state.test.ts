import * as fsp from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
}));

const { loadReviewModel, saveReviewModel } = await import("../review/state.js");

describe("review model state", () => {
	afterEach(() => vi.clearAllMocks());

	test("loads only a valid model reference", async () => {
		vi.mocked(fsp.readFile).mockResolvedValue('{"reviewModel":{"provider":"test","id":"safe"}}');
		await expect(loadReviewModel()).resolves.toEqual({ provider: "test", id: "safe" });

		vi.mocked(fsp.readFile).mockResolvedValue('{"reviewModel":{"provider":"test"}}');
		await expect(loadReviewModel()).resolves.toBeUndefined();
	});

	test("returns undefined when configuration cannot be read", async () => {
		vi.mocked(fsp.readFile).mockRejectedValue(new Error("missing"));
		await expect(loadReviewModel()).resolves.toBeUndefined();
	});

	test("persists only the selected model", async () => {
		await saveReviewModel({ provider: "test", id: "safe" });
		expect(fsp.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("config.json"),
			'{\n  "reviewModel": {\n    "provider": "test",\n    "id": "safe"\n  }\n}\n',
			"utf8",
		);
	});
});
