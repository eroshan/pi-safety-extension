import { describe, expect, test } from "vitest";
import { dedupe } from "../src/review/dedupe.js";

describe("dedupe", () => {
	test("dedupes concurrent calls by key", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			await new Promise((r) => setTimeout(r, 10));
			return "ok";
		};

		const [a, b, c] = await Promise.all([dedupe("k", fn), dedupe("k", fn), dedupe("k", fn)]);
		expect(a).toBe("ok");
		expect(b).toBe("ok");
		expect(c).toBe("ok");
		expect(calls).toBe(1);
	});

	test("different keys do not dedupe", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return calls;
		};

		const [a, b] = await Promise.all([dedupe("k1", fn), dedupe("k2", fn)]);
		expect([a, b].sort()).toEqual([1, 2]);
	});
});
