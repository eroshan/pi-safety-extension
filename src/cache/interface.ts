import type { SafetyVerdict } from "../review/verdict.js";

export interface SafetyCache {
	get(key: string): Promise<SafetyVerdict | undefined>;
	set(key: string, verdict: SafetyVerdict): Promise<void>;
}
