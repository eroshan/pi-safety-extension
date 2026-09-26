import * as fsp from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	rename: vi.fn(),
	unlink: vi.fn(),
}));

const { getReviewConfigPath, loadReviewModel, saveReviewModel } = await import("../review/state.js");

const configPath = "/stable/pi/safety-extension/config.json";

describe("review model state", () => {
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.PI_CODING_AGENT_DIR;
	});

	test("loads only a valid non-empty model reference", async () => {
		vi.mocked(fsp.readFile).mockResolvedValue('{"reviewModel":{"provider":"test","id":"safe"}}');
		await expect(loadReviewModel(configPath)).resolves.toEqual({ provider: "test", id: "safe" });

		vi.mocked(fsp.readFile).mockResolvedValue('{"reviewModel":{"provider":"test","id":""}}');
		await expect(loadReviewModel(configPath)).resolves.toBeUndefined();
	});

	test("returns undefined when configuration cannot be read", async () => {
		vi.mocked(fsp.readFile).mockRejectedValue(new Error("missing"));
		await expect(loadReviewModel(configPath)).resolves.toBeUndefined();
	});

	test("migrates a legacy package-local selection to durable storage", async () => {
		vi.mocked(fsp.readFile)
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce('{"reviewModel":{"provider":"test","id":"legacy"}}');

		await expect(loadReviewModel(configPath)).resolves.toEqual({ provider: "test", id: "legacy" });
		expect(fsp.rename).toHaveBeenCalledWith(expect.stringContaining("config.json."), configPath);
	});

	test("stores configuration atomically outside the package checkout", async () => {
		await saveReviewModel({ provider: "test", id: "safe" }, configPath);

		expect(fsp.mkdir).toHaveBeenCalledWith("/stable/pi/safety-extension", {
			mode: 0o700,
			recursive: true,
		});
		const temporaryPath = vi.mocked(fsp.writeFile).mock.calls[0]?.[0] as string;
		expect(temporaryPath).toMatch(/^\/stable\/pi\/safety-extension\/config\.json\.\d+\..+\.tmp$/);
		expect(fsp.writeFile).toHaveBeenCalledWith(
			temporaryPath,
			'{\n  "reviewModel": {\n    "provider": "test",\n    "id": "safe"\n  }\n}\n',
			{ encoding: "utf8", mode: 0o600 },
		);
		expect(fsp.rename).toHaveBeenCalledWith(temporaryPath, configPath);
	});

	test("removes a temporary file when an atomic save fails", async () => {
		vi.mocked(fsp.rename).mockRejectedValue(new Error("read only"));
		vi.mocked(fsp.unlink).mockResolvedValue(undefined);
		await expect(saveReviewModel({ provider: "test", id: "safe" }, configPath))
			.rejects.toThrow("read only");

		const temporaryPath = vi.mocked(fsp.writeFile).mock.calls[0]?.[0] as string;
		expect(fsp.unlink).toHaveBeenCalledWith(temporaryPath);
	});

	test("honors PI_CODING_AGENT_DIR", () => {
		process.env.PI_CODING_AGENT_DIR = "/custom/pi";
		expect(getReviewConfigPath()).toBe("/custom/pi/safety-extension/config.json");
	});
});
