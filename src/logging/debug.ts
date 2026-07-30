import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionStatePaths } from "../state.js";
import { envBool, safeJsonLine } from "./common.js";

export function createDebugLogger(state: ExtensionStatePaths) {
	return {
		log(event: string, data?: unknown) {
			if (!envBool(process.env.SAFETY_DEBUG_ENABLED, false)) return;
			const line = safeJsonLine({ ts: Date.now(), event, data });
			fs.mkdirSync(path.dirname(state.debugLogPath), { recursive: true });
			fs.appendFileSync(state.debugLogPath, line + "\n", "utf8");
		},
	};
}
