import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionStatePaths } from "../state.js";
import { envBool, safeJsonLine } from "./common.js";

export function createAuditLogger(state: ExtensionStatePaths) {
	return {
		log(entry: Record<string, unknown>) {
			if (!envBool(process.env.SAFETY_BASH_AUDIT_ENABLED, true)) return;
			const line = safeJsonLine({ ts: Date.now(), ...entry });
			fs.mkdirSync(path.dirname(state.auditLogPath), { recursive: true });
			fs.appendFileSync(state.auditLogPath, line + "\n", "utf8");
		},
	};
}
