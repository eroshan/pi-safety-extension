import * as path from "node:path";
import type { ExtensionStatePaths } from "../../src/state.js";

export function makeState(root: string): ExtensionStatePaths {
	return {
		extensionDir: root,
		stateDir: path.join(root, "state"),
		logsDir: path.join(root, "state", "logs"),
		configPath: path.join(root, "state", "config.json"),
		auditLogPath: path.join(root, "state", "logs", "bash-audit.log"),
		cacheMirrorLogPath: path.join(root, "state", "logs", "cache-mirror.log"),
		debugLogPath: path.join(root, "state", "logs", "debug.log"),
		defaultSqlitePath: path.join(root, "state", "cache.sqlite3"),
	};
}
