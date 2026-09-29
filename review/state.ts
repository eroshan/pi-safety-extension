import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export interface ReviewModelRef {
	provider: string;
	id: string;
}

export function getReviewConfigPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "safety-extension", "config.json");
}

function legacyReviewConfigPath(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../state/config.json");
}

async function readReviewModel(configPath: string): Promise<ReviewModelRef | undefined> {
	try {
		const parsed = JSON.parse(await fsp.readFile(configPath, "utf8")) as { reviewModel?: unknown };
		const model = parsed.reviewModel;
		if (!model || typeof model !== "object") return undefined;
		const { provider, id } = model as Record<string, unknown>;
		return typeof provider === "string" && provider.length > 0 && typeof id === "string" && id.length > 0
			? { provider, id }
			: undefined;
	} catch {
		return undefined;
	}
}

export async function loadReviewModel(
	configPath: string = getReviewConfigPath(),
): Promise<ReviewModelRef | undefined> {
	const current = await readReviewModel(configPath);
	if (current) return current;

	const legacyPath = legacyReviewConfigPath();
	if (path.resolve(configPath) === legacyPath) return undefined;
	const legacy = await readReviewModel(legacyPath);
	if (!legacy) return undefined;

	try {
		await saveReviewModel(legacy, configPath);
	} catch {
		// The valid legacy selection remains usable for this process even when migration fails.
	}
	return legacy;
}

export async function saveReviewModel(
	reviewModel: ReviewModelRef,
	configPath: string = getReviewConfigPath(),
): Promise<void> {
	const stateDir = path.dirname(configPath);
	const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
	await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
	try {
		await fsp.writeFile(
			temporaryPath,
			`${JSON.stringify({ reviewModel }, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
		await fsp.rename(temporaryPath, configPath);
	} catch (error) {
		await fsp.unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}
