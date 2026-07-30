import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionStatePaths } from "../state.js";
import { envBool, safeJsonLine } from "./common.js";

export function createCacheMirrorLogger(state: ExtensionStatePaths) {
	return {
		log(entry: Record<string, unknown>) {
			if (!envBool(process.env.SAFETY_CACHE_MIRROR_ENABLED, false)) return;
			const line = safeJsonLine({ ts: Date.now(), ...entry });
			fs.mkdirSync(path.dirname(state.cacheMirrorLogPath), { recursive: true });
			fs.appendFileSync(state.cacheMirrorLogPath, line + "\n", "utf8");
		},
	};
}
