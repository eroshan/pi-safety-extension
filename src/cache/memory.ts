import type { SafetyCache } from "./interface.js";
import type { SafetyVerdict } from "../review/verdict.js";

export function createMemoryCache(maxEntries: number): SafetyCache {
	const map = new Map<string, { v: SafetyVerdict; ts: number }>();

	function prune() {
		if (map.size <= maxEntries) return;
		// Remove oldest entries
		const entries = Array.from(map.entries()).sort((a, b) => a[1].ts - b[1].ts);
		const toRemove = entries.slice(0, Math.max(0, map.size - maxEntries));
		for (const [k] of toRemove) map.delete(k);
	}

	return {
		async get(key: string) {
			return map.get(key)?.v;
		},
		async set(key: string, verdict: SafetyVerdict) {
			map.set(key, { v: verdict, ts: Date.now() });
			prune();
		},
	};
}
