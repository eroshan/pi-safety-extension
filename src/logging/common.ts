import { parseBool } from "../util/env.js";

export function safeJsonLine(obj: unknown): string {
	try {
		return JSON.stringify(obj);
	} catch {
		return JSON.stringify({ ts: Date.now(), error: "json_stringify_failed" });
	}
}

export { parseBool as envBool };
